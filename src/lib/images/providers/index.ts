import "server-only";
import { env } from "../../env";
import { OpenAIImageProvider } from "./openai";
import type { ImageProvider } from "./types";

export const IMAGE_PROVIDER_OPTIONS = [
  { id: "openai", label: "OpenAI Images API" },
  { id: "none", label: "Ingen (kun egne bilder, komposisjon og tekstgrafikk)" },
] as const;

export function getImageProvider(id: string): ImageProvider | null {
  if (id === "openai") {
    const e = env();
    return new OpenAIImageProvider(e.OPENAI_API_KEY, e.OPENAI_IMAGE_MODEL);
  }
  return null;
}
