"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/security";
import { audit } from "@/lib/audit";
import { toActionError, UserFacingError, type ActionResult } from "@/lib/action-result";
import { getSettings } from "@/lib/data";
import { integrations } from "@/lib/env";
import { osloToUtc } from "@/lib/dates";
import { callClaudeStructured } from "@/lib/ai/claude";
import { buildRulesText, WINNER_PLACEHOLDER, type ContestInput } from "@/lib/contests/rules";
import { drawWinners, parseEntries } from "@/lib/contests/draw";
import { generateContestPosts, templateContestPosts } from "@/lib/contests/generate";
import { utmFromSettings, withUtm } from "@/lib/posts/utm";
import { uuidSchema } from "@/lib/posts/validation";

const local = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Ugyldig dato/tid");
const toUtc = (v: string) => {
  const [d, t] = v.split("T") as [string, string];
  return osloToUtc(d, t).toISOString();
};

const schema = z
  .object({
    title: z.string().trim().min(3, "Skriv en tittel").max(200),
    prize: z.string().trim().min(3, "Beskriv premien").max(500),
    prize_product_id: z.union([z.string().uuid(), z.literal("")]).transform((v) => v || null),
    question: z.string().trim().max(300).transform((v) => v || null),
    entry_method: z.enum(["kommentar", "kommentar_like"]),
    min_age: z.coerce.number().int().min(13).max(99),
    region: z.string().trim().min(2).max(100),
    starts_at: local.transform(toUtc),
    ends_at: local.transform(toUtc),
    announce_at: local.transform(toUtc),
    winner_count: z.coerce.number().int().min(1).max(10),
    delivery_note: z.string().trim().max(300).transform((v) => v || null),
  })
  .refine((c) => new Date(c.starts_at) < new Date(c.ends_at), { message: "Slutten må være etter starten." })
  .refine((c) => new Date(c.ends_at) <= new Date(c.announce_at), { message: "Vinneren kan ikke kunngjøres før konkurransen er slutt." })
  .refine((c) => new Date(c.starts_at).getTime() > Date.now() - 3600_000, { message: "Starten kan ikke være i fortiden." });

function hint(err: { code?: string; message?: string } | null | undefined) {
  if (err?.code === "42P01" || err?.code === "PGRST205" || err?.code === "PGRST204" || /contest/.test(err?.message ?? "")) {
    return new UserFacingError("Databasen mangler oppdateringen for konkurranser. Kjør supabase/migrations/20261109000008_contests.sql i Supabase → SQL Editor.");
  }
  return null;
}

/** Oppretter konkurransen og tre innlegg (kunngjøring, påminnelse, vinner) som venter på godkjenning. */
export async function createContest(_prev: ActionResult<{ id: string }> | undefined, fd: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const owner = await requireOwner();
    const input = schema.parse(Object.fromEntries(["title", "prize", "prize_product_id", "question", "entry_method", "min_age", "region", "starts_at", "ends_at", "announce_at", "winner_count", "delivery_note"].map((k) => [k, String(fd.get(k) ?? "")])));
    await enforceRateLimit(`ai:${owner.id}`, 20, 3600);
    const settings = await getSettings();
    const supabase = await createClient();
    const product = input.prize_product_id ? (await supabase.from("products").select("name, description, product_url").eq("id", input.prize_product_id).maybeSingle()).data : null;
    const c: ContestInput = { ...input, business_name: settings.business_name };

    const { data: contest, error } = await supabase
      .from("contests")
      .insert({ ...input, rules_text: buildRulesText(c), status: "utkast" })
      .select("id")
      .single();
    if (error) throw hint(error) ?? error;

    const ai = integrations().anthropic;
    const gen = ai ? await generateContestPosts(c, product ?? null, callClaudeStructured, settings.ai_model) : { posts: templateContestPosts(c), model: null };
    const reminderAt = new Date(new Date(input.ends_at).getTime() - 24 * 3600_000);
    const when: Record<string, string | null> = {
      kunngjoring: input.starts_at,
      paminnelse: reminderAt.getTime() > new Date(input.starts_at).getTime() + 12 * 3600_000 ? reminderAt.toISOString() : null,
      vinner: input.announce_at,
    };
    const utm = utmFromSettings(settings);
    const rows = gen.posts
      .filter((p) => when[p.role] !== null)
      .map((p) => {
        const id = randomUUID();
        return {
          id,
          title: p.title,
          content: p.content,
          hashtags: p.hashtags,
          link_url: p.role === "kunngjoring" ? withUtm(product?.product_url ?? settings.website, settings.website, { settings: utm, campaign: "konkurranse", postId: id }) : null,
          product_id: input.prize_product_id,
          post_type: "konkurranse",
          rationale: p.role === "kunngjoring" ? "Konkurranse for å øke engasjement og nå nye følgere. Vilkårene er lagt til automatisk." : null,
          verification_notes: p.warnings,
          scheduled_at: when[p.role],
          status: ai ? "PENDING_APPROVAL" : "DRAFT",
          generated_by: ai ? "ai" : "owner",
          ai_model: gen.model,
          contest_id: contest.id,
          contest_role: p.role,
        };
      });
    const { error: pErr } = await supabase.from("posts").insert(rows);
    if (pErr) throw hint(pErr) ?? pErr;
    await audit("contest.created", { actorId: owner.id, entity: "contest", entityId: contest.id, details: { posts: rows.length } });
    revalidatePath("/", "layout");
    return { ok: true, message: "Konkurransen og innleggene er laget. Gå gjennom og godkjenn innleggene.", data: { id: contest.id } };
  } catch (err) {
    return toActionError(err, "createContest");
  }
}

/** Trekker vinner(e) fra en innlimt deltakerliste og setter navnet inn i vinnerinnlegget. */
export async function drawContest(id: string, rawEntries: string): Promise<ActionResult<{ winners: string[]; entries: number }>> {
  try {
    const owner = await requireOwner();
    uuidSchema.parse(id);
    const entries = parseEntries(z.string().max(200_000).parse(rawEntries));
    if (!entries.length) throw new UserFacingError("Lim inn minst én deltaker (én per linje).");
    const supabase = await createClient();
    const { data: c, error } = await supabase.from("contests").select("id, ends_at, winner_count, status").eq("id", id).single();
    if (error) throw hint(error) ?? error;
    if (c.status === "trukket") throw new UserFacingError("Vinneren er allerede trukket.");
    if (c.status === "avlyst") throw new UserFacingError("Konkurransen er avlyst.");
    if (new Date(c.ends_at).getTime() > Date.now()) throw new UserFacingError("Konkurransen er ikke avsluttet ennå – vent til fristen har gått ut.");

    const { winners, listHash } = drawWinners(entries, c.winner_count);
    const { error: uErr } = await supabase
      .from("contests")
      .update({ winners, entries_count: entries.length, drawn_at: new Date().toISOString(), draw_seed_hash: listHash, status: "trukket" })
      .eq("id", id);
    if (uErr) throw uErr;

    // Sett navnet inn i vinnerinnlegget (hvis det ikke allerede er publisert).
    const { data: wp } = await supabase.from("posts").select("id, content, status").eq("contest_id", id).eq("contest_role", "vinner").maybeSingle();
    if (wp && !["PUBLISHED", "PUBLISHING"].includes(wp.status)) {
      const names = winners.length === 1 ? winners[0]! : `${winners.slice(0, -1).join(", ")} og ${winners[winners.length - 1]}`;
      await supabase
        .from("posts")
        .update({ content: wp.content.split(WINNER_PLACEHOLDER).join(names), verification_notes: ["Husk å kontakte vinneren og få bekreftet at navnet kan publiseres."] })
        .eq("id", wp.id);
    }
    await audit("contest.drawn", { actorId: owner.id, entity: "contest", entityId: id, details: { entries: entries.length, winners: winners.length, listHash } });
    revalidatePath("/", "layout");
    return { ok: true, message: "Vinneren er trukket.", data: { winners, entries: entries.length } };
  } catch (err) {
    return toActionError(err, "drawContest");
  }
}

export async function setContestStatus(id: string, status: "aktiv" | "avsluttet" | "avlyst"): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    uuidSchema.parse(id);
    const supabase = await createClient();
    const { error } = await supabase.from("contests").update({ status }).eq("id", id).neq("status", "trukket");
    if (error) throw hint(error) ?? error;
    await audit("contest.status", { actorId: owner.id, entity: "contest", entityId: id, details: { status } });
    revalidatePath("/konkurranser", "layout");
    return { ok: true, message: status === "avlyst" ? "Konkurransen er avlyst. Avvis eller slett innleggene som ikke skal publiseres." : "Status er oppdatert." };
  } catch (err) {
    return toActionError(err, "setContestStatus");
  }
}

/** Sletter konkurransen og innlegg som ikke er publisert. */
export async function deleteContest(id: string): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    uuidSchema.parse(id);
    const supabase = await createClient();
    await supabase.from("posts").delete().eq("contest_id", id).not("status", "in", "(PUBLISHED,PUBLISHING)");
    const { error } = await supabase.from("contests").delete().eq("id", id);
    if (error) throw hint(error) ?? error;
    await audit("contest.deleted", { actorId: owner.id, entity: "contest", entityId: id });
    revalidatePath("/", "layout");
    return { ok: true, message: "Konkurransen er slettet." };
  } catch (err) {
    return toActionError(err, "deleteContest");
  }
}
