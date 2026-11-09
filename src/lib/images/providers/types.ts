import type { ImageFormat } from "../formats";

/**
 * Utskiftbar bildegenerator. Nye leverandører implementerer dette
 * grensesnittet og registreres i providers/index.ts.
 */
export interface ImageGenerationRequest {
  prompt: string;
  format: ImageFormat;
}

export interface ImageGenerationResult {
  data: Buffer;
  mimeType: string;
  provider: string;
  model: string;
}

export interface ImageProvider {
  readonly id: string;
  readonly label: string;
  isConfigured(): boolean;
  generate(req: ImageGenerationRequest): Promise<ImageGenerationResult>;
}
