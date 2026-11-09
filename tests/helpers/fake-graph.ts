import { GraphClient } from "@/lib/facebook/graph";

/**
 * Simulert Meta Graph API for tester. Registrerer alle kall slik at testene
 * kan bevise at ingenting sendes til Facebook når det ikke skal.
 */
export interface FakeGraphOptions {
  publish?: "ok" | "error-token" | "error-permission" | "timeout" | "timeout-but-created" | "error-500";
  /** Status Facebook rapporterer for video etter opplasting */
  videoStatus?: "ready" | "processing" | "error";
}

export function fakeGraph(opts: FakeGraphOptions = {}) {
  const calls: { method: string; path: string; body: Record<string, string> }[] = [];
  const created: { id: string; message: string; created_time: string; permalink_url: string }[] = [];
  let n = 0;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "rupload.facebook.com") {
      calls.push({ method: "RUPLOAD", path: url.pathname, body: Object.fromEntries(new Headers(init?.headers).entries()) });
      return json(200, { success: true });
    }
    const path = url.pathname.replace(/^\/v\d+\.\d+\//, "");
    const body = Object.fromEntries(new URLSearchParams((init?.body as URLSearchParams | undefined)?.toString() ?? ""));
    const method = init?.method ?? "GET";
    calls.push({ method, path, body: method === "GET" ? Object.fromEntries(url.searchParams) : body });

    if (method === "POST" && path.endsWith("/video_reels")) {
      if (body.upload_phase === "start") return json(200, { video_id: `reel_${++n}` });
      if (body.upload_phase === "finish") {
        created.push({ id: body.video_id!, message: body.description ?? "", created_time: new Date().toISOString(), permalink_url: `https://www.facebook.com/reel/${body.video_id}` });
        return json(200, { success: true });
      }
    }
    if (method === "POST" && path.endsWith("/videos")) {
      const id = `video_${++n}`;
      created.push({ id, message: body.description ?? "", created_time: new Date().toISOString(), permalink_url: `https://www.facebook.com/${id}` });
      return json(200, { id });
    }
    if (method === "GET" && /^(reel|video)_\d+$/.test(path)) {
      const st = opts.videoStatus ?? "ready";
      return json(200, { status: { video_status: st, ...(st === "error" ? { processing_phase: { status: "error", error: { message: "Ugyldig videoformat" } } } : {}) }, permalink_url: `/reel/${path}` });
    }
    if (method === "POST" && /\/(feed|photos)$/.test(path)) {
      const mode = opts.publish ?? "ok";
      if (mode === "error-token") return json(400, { error: { message: "Error validating access token", code: 190 } });
      if (mode === "error-permission") return json(403, { error: { message: "Missing permission", code: 200 } });
      if (mode === "error-500") return json(500, { error: { message: "An unknown error occurred", code: 1 } });
      const id = `999_${++n}`;
      if (mode === "timeout" || mode === "timeout-but-created") {
        if (mode === "timeout-but-created") created.push({ id, message: body.message ?? body.caption ?? "", created_time: new Date().toISOString(), permalink_url: `https://www.facebook.com/${id}` });
        throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
      }
      created.push({ id, message: body.message ?? body.caption ?? "", created_time: new Date().toISOString(), permalink_url: `https://www.facebook.com/${id}` });
      return path.endsWith("photos") ? json(200, { id: `photo_${n}`, post_id: id }) : json(200, { id });
    }
    if (method === "GET" && path.endsWith("/published_posts")) return json(200, { data: created });
    if (method === "GET" && /^999_\d+$/.test(path)) {
      const c = created.find((x) => x.id === path);
      return c ? json(200, c) : json(404, { error: { message: "Not found", code: 100 } });
    }
    return json(404, { error: { message: `Ukjent sti i testen: ${method} ${path}`, code: 100 } });
  };

  const graph = new GraphClient({ appId: "app", appSecret: "secret", version: "v99.0", fetchImpl, timeoutMs: 1000 });
  return {
    graph,
    calls,
    created,
    publishCalls: () => calls.filter((c) => c.method === "POST" && /\/(feed|photos|videos)$/.test(c.path)),
    reelCalls: () => calls.filter((c) => c.path.endsWith("/video_reels") || c.method === "RUPLOAD"),
  };
}
