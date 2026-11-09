"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { disconnect, graphClient, saveConnection, verifyConnection } from "@/lib/facebook/connection";
import { clearOAuthCookie, readOAuthCookie } from "@/lib/facebook/oauth-cookie";
import { audit } from "@/lib/audit";
import { toActionError, UserFacingError, type ActionResult } from "@/lib/action-result";

export async function confirmPage(_prev: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  let ok = false;
  try {
    const owner = await requireOwner();
    const pageId = z.string().regex(/^\d+$/).parse(fd.get("page_id"));
    const cookie = await readOAuthCookie();
    if (!cookie?.userToken) throw new UserFacingError("Innloggingen hos Facebook er utløpt. Start tilkoblingen på nytt.");
    const graph = graphClient();
    if (!graph) throw new UserFacingError("Meta-appen er ikke konfigurert.");
    const pages = await graph.listPages(cookie.userToken);
    const page = pages.find((p) => p.id === pageId);
    if (!page) throw new UserFacingError("Fant ikke siden. Har du gitt tilgang til den hos Facebook?");
    if (page.tasks && !page.tasks.includes("CREATE_CONTENT")) throw new UserFacingError("Du har ikke rettighet til å publisere innhold på denne siden.");
    const info = await graph.debugToken(page.access_token);
    if (!info.isValid) throw new UserFacingError("Facebook ga et ugyldig sidetoken. Prøv igjen.");
    await saveConnection({ pageId: page.id, pageName: page.name, pageToken: page.access_token, expiresAt: info.expiresAt, scopes: info.scopes.length ? info.scopes : cookie.scopes ?? [], connectedBy: owner.id });
    await clearOAuthCookie();
    await audit("facebook.connected", { actorId: owner.id, details: { pageId: page.id, pageName: page.name } });
    ok = true;
  } catch (err) {
    return toActionError(err, "confirmPage");
  }
  if (ok) {
    revalidatePath("/", "layout");
    redirect("/innstillinger?fb=tilkoblet#facebook");
  }
  return { ok: true };
}

export async function cancelConnect() {
  await requireOwner();
  await clearOAuthCookie();
  redirect("/innstillinger#facebook");
}

export async function disconnectFacebook(): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    await disconnect();
    await audit("facebook.disconnected", { actorId: owner.id });
    revalidatePath("/", "layout");
    return { ok: true, message: "Facebook er koblet fra, og tokenet er slettet. Du kan også fjerne appen under Facebook → Innstillinger → Bedriftsintegrasjoner." };
  } catch (err) {
    return toActionError(err, "disconnectFacebook");
  }
}

export async function checkFacebook(): Promise<ActionResult> {
  try {
    await requireOwner();
    const r = await verifyConnection();
    revalidatePath("/", "layout");
    return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
  } catch (err) {
    return toActionError(err, "checkFacebook");
  }
}
