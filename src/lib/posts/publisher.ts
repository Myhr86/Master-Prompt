import { postContentHash, composeFacebookMessage } from "./content-hash";
import { PUBLISHABLE_STATUSES, type PostStatus } from "./status";
import { GraphError, postUrl, type GraphClient } from "../facebook/graph";

/**
 * Publiseringstjenesten. All tilgang til database og Facebook går via
 * PublishStore/GraphClient slik at logikken kan testes isolert.
 *
 * Sikkerhetslag mot feilpublisering:
 *  1. Forhåndskontroller her (godkjenning, hash, bilde, tilkobling, ikke publisert).
 *  2. claim_post_for_publishing() i databasen kontrollerer det samme atomisk
 *     med radlås og unik idempotensnøkkel.
 *  3. Statusmaskinen i databasen tillater PUBLISHED kun fra PUBLISHING med
 *     bekreftet Facebook-ID og uendret innhold.
 */
export interface PublishablePost {
  id: string;
  title: string;
  content: string;
  hashtags: string[];
  link_url: string | null;
  image_path: string | null;
  status: PostStatus;
  approved_at: string | null;
  approved_content_hash: string | null;
  facebook_post_id: string | null;
  facebook_post_url?: string | null;
}

export interface PublishAttempt {
  id: string;
  post_id: string;
  state: "in_progress" | "succeeded" | "failed" | "unknown";
  mode: "live" | "simulated";
  started_at: string;
}

export interface FacebookConnectionSecret {
  pageId: string;
  pageName: string;
  token: string;
  status: string;
  expiresAt: Date | null;
}

export interface PublishStore {
  getPost(id: string): Promise<PublishablePost | null>;
  claim(postId: string, mode: "live" | "simulated"): Promise<PublishAttempt>;
  latestAttempt(postId: string): Promise<PublishAttempt | null>;
  completeAttempt(attemptId: string, state: "succeeded" | "failed" | "unknown", info: { facebookPostId?: string; error?: string; pageId?: string }): Promise<void>;
  markPublished(postId: string, facebookPostId: string, url: string | null): Promise<void>;
  markFailed(postId: string, error: string): Promise<void>;
  getConnection(): Promise<FacebookConnectionSecret | null>;
  setConnectionStatus(status: "connected" | "expired" | "revoked" | "error", error: string | null): Promise<void>;
  imageUrl(path: string): Promise<string | null>;
}

export interface PublishDeps {
  store: PublishStore;
  graph: GraphClient | null;
  mode: "live" | "simulated";
  /** Sjekker at bilde-URL-en faktisk svarer. Kan overstyres i tester. */
  checkImage?: (url: string) => Promise<boolean>;
  now?: () => Date;
}

export type PublishResult =
  | { ok: true; simulated: boolean; facebookPostId: string | null; url: string | null; alreadyPublished?: boolean; message: string }
  | { ok: false; reason: PublishFailure; message: string };

export type PublishFailure =
  | "not_found"
  | "not_approved"
  | "approval_invalid"
  | "already_published"
  | "in_progress"
  | "image_unavailable"
  | "not_connected"
  | "token_expired"
  | "facebook_error"
  | "unknown_outcome";

const fail = (reason: PublishFailure, message: string): PublishResult => ({ ok: false, reason, message });

async function defaultCheckImage(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10_000), cache: "no-store" });
    return r.ok && (r.headers.get("content-type") ?? "").startsWith("image/");
  } catch {
    return false;
  }
}

export function buildMessage(post: PublishablePost, isPhoto: boolean): string {
  const msg = composeFacebookMessage(post);
  // Bildeinnlegg har ikke eget lenkefelt – lenken legges i teksten.
  if (isPhoto && post.link_url && !msg.includes(post.link_url)) return `${msg}\n\n${post.link_url}`;
  return msg;
}

/** Ren validering av at et innlegg kan publiseres. */
export function validateForPublishing(post: PublishablePost): PublishResult | null {
  if (post.status === "PUBLISHED" || post.facebook_post_id) return fail("already_published", "Innlegget er allerede publisert.");
  if (post.status === "PUBLISHING") return fail("in_progress", "Publisering pågår allerede.");
  if (!PUBLISHABLE_STATUSES.includes(post.status) || !post.approved_at || !post.approved_content_hash) {
    return fail("not_approved", "Innlegget må godkjennes før det kan publiseres.");
  }
  if (post.approved_content_hash !== postContentHash(post)) {
    return fail("approval_invalid", "Innholdet er endret etter godkjenning. Godkjenn innlegget på nytt.");
  }
  return null;
}

export async function publishPost(postId: string, deps: PublishDeps): Promise<PublishResult> {
  const { store } = deps;
  const checkImage = deps.checkImage ?? defaultCheckImage;
  let post = await store.getPost(postId);
  if (!post) return fail("not_found", "Fant ikke innlegget.");

  if (post.status === "PUBLISHED") {
    return { ok: true, simulated: false, facebookPostId: post.facebook_post_id, url: post.facebook_post_url ?? null, alreadyPublished: true, message: "Innlegget var allerede publisert." };
  }

  // Et tidligere forsøk med uklart utfall må avklares mot Facebook før nytt forsøk.
  if (post.status === "PUBLISHING") {
    const reconciled = await reconcile(post, deps);
    if (reconciled) return reconciled;
    post = await store.getPost(postId);
    if (!post) return fail("not_found", "Fant ikke innlegget.");
  }

  const invalid = validateForPublishing(post);
  if (invalid) return invalid;

  // Bildet må være tilgjengelig.
  let imageUrl: string | null = null;
  if (post.image_path) {
    imageUrl = await store.imageUrl(post.image_path);
    if (!imageUrl || !(await checkImage(imageUrl))) return fail("image_unavailable", "Bildet til innlegget er ikke tilgjengelig. Velg eller last opp bildet på nytt.");
  }

  // Facebook-tilkoblingen må fungere (også i testmodus kontrolleres status hvis den finnes).
  const conn = await store.getConnection();
  if (deps.mode === "live") {
    if (!deps.graph) return fail("not_connected", "Facebook-integrasjonen er ikke konfigurert på serveren.");
    if (!conn || conn.status !== "connected") return fail("not_connected", "Facebook-siden er ikke tilkoblet. Koble til under Innstillinger.");
    if (conn.expiresAt && conn.expiresAt.getTime() <= (deps.now?.() ?? new Date()).getTime()) {
      await store.setConnectionStatus("expired", "Tokenet er utløpt");
      return fail("token_expired", "Facebook-tilgangen er utløpt. Koble til Facebook på nytt.");
    }
  }

  // Atomisk lås i databasen (kontrollerer godkjenning på nytt).
  let attempt: PublishAttempt;
  try {
    attempt = await store.claim(post.id, deps.mode);
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (/allerede publisert/i.test(msg)) return fail("already_published", msg);
    if (/pågår|uavklart|fullført/i.test(msg)) return fail("in_progress", msg);
    if (/godkjenning/i.test(msg)) return fail("approval_invalid", msg);
    throw err;
  }

  const isPhoto = Boolean(imageUrl);
  const message = buildMessage(post, isPhoto);

  if (deps.mode === "simulated") {
    await store.completeAttempt(attempt.id, "succeeded", {});
    return {
      ok: true,
      simulated: true,
      facebookPostId: null,
      url: null,
      message: `Testmodus: publiseringen ble simulert. Alle kontroller var OK (${isPhoto ? "bildeinnlegg" : post.link_url ? "lenkeinnlegg" : "tekstinnlegg"}). Ingenting ble sendt til Facebook.`,
    };
  }

  const graph = deps.graph!;
  const c = conn!;
  try {
    let fbId: string;
    if (isPhoto) {
      const r = await graph.publishPhoto(c.pageId, c.token, { imageUrl: imageUrl!, caption: message });
      fbId = r.post_id ?? r.id;
    } else {
      const r = await graph.publishFeed(c.pageId, c.token, { message, link: post.link_url });
      fbId = r.id;
    }
    if (!fbId) throw new GraphError("Facebook returnerte ingen ID", 200, undefined, undefined, "unknown_outcome");
    // Bekreft hos Facebook og hent permalenke.
    let url: string | null = postUrl(fbId);
    try {
      const confirmed = await graph.getPost(fbId, c.token);
      url = confirmed.permalink_url ?? url;
    } catch {
      /* Innlegget er opprettet (vi har ID fra Facebook); permalenke er valgfri. */
    }
    await store.markPublished(post.id, fbId, url);
    await store.completeAttempt(attempt.id, "succeeded", { facebookPostId: fbId, pageId: c.pageId });
    return { ok: true, simulated: false, facebookPostId: fbId, url, message: "Innlegget er publisert og bekreftet av Facebook." };
  } catch (err) {
    const ge = err instanceof GraphError ? err : new GraphError((err as Error).message ?? "Ukjent feil", 0, undefined, undefined, "unknown_outcome");
    if (ge.kind === "unknown_outcome") {
      await store.completeAttempt(attempt.id, "unknown", { error: ge.message, pageId: c.pageId });
      // Avklar umiddelbart om mulig.
      const reconciled = await reconcile({ ...post, status: "PUBLISHING" }, deps);
      if (reconciled) return reconciled;
      return fail("unknown_outcome", "Uklart svar fra Facebook. Systemet kontrollerer Facebook før et nytt forsøk – ikke publiser manuelt i mellomtiden.");
    }
    await store.completeAttempt(attempt.id, "failed", { error: ge.message, pageId: c.pageId });
    await store.markFailed(post.id, friendlyGraphError(ge));
    if (ge.needsReconnect) {
      await store.setConnectionStatus("expired", ge.message);
      return fail("token_expired", "Facebook-tilgangen er utløpt eller tilbakekalt. Koble til Facebook på nytt.");
    }
    return fail("facebook_error", friendlyGraphError(ge));
  }
}

/**
 * Avklarer et uklart forsøk ved å sjekke Facebook. Returnerer et resultat
 * hvis saken er avgjort (publisert, eller fortsatt uavklart), ellers null
 * (innlegget er satt til FAILED og kan prøves på nytt).
 */
async function reconcile(post: PublishablePost, deps: PublishDeps): Promise<PublishResult | null> {
  const { store } = deps;
  const attempt = await store.latestAttempt(post.id);
  if (!attempt || attempt.mode !== "live") {
    await store.markFailed(post.id, "Publiseringen ble avbrutt.");
    return null;
  }
  if (attempt.state === "succeeded") {
    // Et parallelt forsøk ble nettopp fullført.
    const fresh = await store.getPost(post.id);
    if (fresh?.status === "PUBLISHED") {
      return { ok: true, simulated: false, facebookPostId: fresh.facebook_post_id, url: fresh.facebook_post_url ?? null, alreadyPublished: true, message: "Innlegget var allerede publisert." };
    }
    return fail("in_progress", "Publisering pågår allerede.");
  }
  if (attempt.state === "in_progress") {
    const ageMs = Date.now() - new Date(attempt.started_at).getTime();
    if (ageMs < 2 * 60_000) return fail("in_progress", "Publisering pågår allerede.");
  }
  if (!deps.graph) return fail("unknown_outcome", "Kan ikke kontrollere Facebook fordi integrasjonen ikke er konfigurert.");
  const conn = await store.getConnection();
  if (!conn) return fail("unknown_outcome", "Kan ikke kontrollere Facebook uten aktiv tilkobling.");

  const isPhoto = Boolean(post.image_path);
  try {
    const found = await deps.graph.findPublishedByMessage(conn.pageId, conn.token, buildMessage(post, isPhoto), new Date(attempt.started_at));
    if (found) {
      await store.markPublished(post.id, found.id, found.permalink_url ?? postUrl(found.id));
      await store.completeAttempt(attempt.id, "succeeded", { facebookPostId: found.id, pageId: conn.pageId });
      return { ok: true, simulated: false, facebookPostId: found.id, url: found.permalink_url ?? postUrl(found.id), message: "Kontroll mot Facebook viste at innlegget allerede er publisert." };
    }
  } catch {
    return fail("unknown_outcome", "Klarte ikke å kontrollere Facebook. Prøv igjen om litt.");
  }
  await store.completeAttempt(attempt.id, "failed", { error: "Ikke funnet på Facebook ved kontroll" });
  await store.markFailed(post.id, "Forrige forsøk ble ikke fullført hos Facebook.");
  return null;
}

export function friendlyGraphError(e: GraphError): string {
  switch (e.kind) {
    case "token":
      return "Facebook-tilgangen er utløpt eller tilbakekalt.";
    case "permission":
      return "Appen mangler nødvendig tillatelse hos Facebook (pages_manage_posts). Sjekk tilkoblingen og Meta App Review.";
    case "transient":
      return "Facebook er midlertidig utilgjengelig eller begrenser forespørsler. Prøv igjen senere.";
    default:
      return `Facebook avviste publiseringen: ${e.message}`;
  }
}
