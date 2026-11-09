/**
 * Strukturert logging med maskering av hemmeligheter.
 * Tokens, nøkler og passord skal aldri havne i loggene.
 */
const SECRET_KEYS = /token|secret|password|passord|api[_-]?key|authorization|cookie|code_verifier|access/i;
const SECRET_VALUES = [
  /EAA[A-Za-z0-9]{20,}/g, // Meta-tokens
  /sk-ant-[A-Za-z0-9_-]{10,}/g, // Anthropic
  /sk-[A-Za-z0-9_-]{20,}/g, // OpenAI
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
];

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[…]";
  if (typeof value === "string") {
    let out = value;
    for (const re of SECRET_VALUES) out = out.replace(re, "[MASKERT]");
    return out.replace(/(access_token|client_secret|fb_exchange_token)=[^&\s]+/gi, "$1=[MASKERT]");
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redact(value.message, depth + 1) };
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.test(k) ? "[MASKERT]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

type Level = "info" | "warn" | "error";

function write(level: Level, event: string, data?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "test" && !process.env.LOG_IN_TESTS) return;
  const line = JSON.stringify({ level, event, time: new Date().toISOString(), ...(redact(data ?? {}) as object) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, data?: Record<string, unknown>) => write("info", event, data),
  warn: (event: string, data?: Record<string, unknown>) => write("warn", event, data),
  error: (event: string, data?: Record<string, unknown>) => write("error", event, data),
};
