import type { ImageProvider, ImageGenerationRequest, ImageGenerationResult } from "./types";
import type { ImageFormat } from "../formats";

const SIZE: Record<ImageFormat, string> = {
  square: "1024x1024",
  portrait: "1024x1536",
  landscape: "1536x1024",
};

export class OpenAIImageProvider implements ImageProvider {
  readonly id = "openai";
  readonly label = "OpenAI Images API";
  constructor(
    private readonly apiKey: string | undefined,
    private readonly model: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  isConfigured() {
    return Boolean(this.apiKey);
  }

  async generate(req: ImageGenerationRequest): Promise<ImageGenerationResult> {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY er ikke satt");
    const res = await this.fetchImpl("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, prompt: req.prompt, size: SIZE[req.format], n: 1 }),
      signal: AbortSignal.timeout(180_000),
    });
    const json = (await res.json().catch(() => null)) as { data?: { b64_json?: string }[]; error?: { message?: string } } | null;
    if (!res.ok || !json?.data?.[0]?.b64_json) {
      throw new Error(`Bildegenerering feilet: ${json?.error?.message ?? `HTTP ${res.status}`}`);
    }
    return { data: Buffer.from(json.data[0].b64_json, "base64"), mimeType: "image/png", provider: this.id, model: this.model };
  }
}
