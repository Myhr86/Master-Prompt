import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

beforeAll(() => {
  Object.assign(process.env, {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-aaaaaaaaaaaaaaaaaaaaaa",
    SUPABASE_SERVICE_ROLE_KEY: "service-key-aaaaaaaaaaaaaaaaaaa",
    APP_URL: "http://localhost:3000",
    OWNER_EMAILS: "eier@example.com",
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
    CRON_SECRET: "c".repeat(40),
    ANTHROPIC_API_KEY: "sk-ant-test-key-not-real",
  });
});

const schema = z.object({ answer: z.string() });
let requests: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];

function mockAnthropic(reply: { text?: string; stop_reason?: string }) {
  requests = [];
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")), headers: new Headers(init?.headers) });
    return new Response(
      JSON.stringify({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: reply.text === undefined ? [] : [{ type: "text", text: reply.text }],
        stop_reason: reply.stop_reason ?? "end_turn",
        stop_sequence: null,
        stop_details: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
      { status: 200, headers: { "content-type": "application/json", "request-id": "req_test" } },
    );
  });
}

describe("Claude-integrasjon (test 3)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("sender strukturert forespørsel til claude-opus-5-5 med adaptiv tenkning og caching", async () => {
    mockAnthropic({ text: JSON.stringify({ answer: "Hei" }) });
    const { callClaudeStructured } = await import("@/lib/ai/claude");
    const r = await callClaudeStructured({ system: "System", user: "Bruker", schema });
    expect(r.data).toEqual({ answer: "Hei" });
    const req = requests[0]!;
    expect(req.url).toContain("/v1/messages");
    expect(req.body.model).toBe("claude-opus-5-5");
    expect(req.body.thinking).toEqual({ type: "adaptive" });
    expect(req.body.fallbacks).toBe("default");
    expect((req.body.output_config as { format: { type: string }; effort: string }).format.type).toBe("json_schema");
    expect((req.body.system as { cache_control: unknown }[])[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(req.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    // Ingen hemmeligheter fra appen sendes i innholdet
    expect(JSON.stringify(req.body)).not.toMatch(/TOKEN_ENCRYPTION_KEY|service-key|EAA/);
  });

  it("sender bilder som bildeblokker før teksten", async () => {
    mockAnthropic({ text: JSON.stringify({ answer: "Et verksted" }) });
    const { callClaudeStructured } = await import("@/lib/ai/claude");
    await callClaudeStructured({ system: "S", user: "Beskriv", schema, images: [{ mediaType: "image/jpeg", base64: "QUJD" }] });
    const content = (requests[0]!.body.messages as { content: { type: string; source?: { data: string } }[] }[])[0]!.content;
    expect(content.map((c) => c.type)).toEqual(["image", "text"]);
    expect(content[0]!.source!.data).toBe("QUJD");
  });

  it("håndterer avslag (refusal) med forståelig melding", async () => {
    mockAnthropic({ stop_reason: "refusal" });
    const { callClaudeStructured } = await import("@/lib/ai/claude");
    await expect(callClaudeStructured({ system: "S", user: "U", schema })).rejects.toThrow(/avslo/);
  });

  it("avviser svar som ikke følger skjemaet", async () => {
    mockAnthropic({ text: JSON.stringify({ feil: 1 }) });
    const { callClaudeStructured } = await import("@/lib/ai/claude");
    await expect(callClaudeStructured({ system: "S", user: "U", schema })).rejects.toThrow(/ikke kunne tolkes|ugyldig format/);
  });
});
