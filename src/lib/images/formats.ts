export const IMAGE_FORMATS = {
  square: { width: 1080, height: 1080, label: "Kvadrat 1:1 (1080×1080)" },
  portrait: { width: 1080, height: 1350, label: "Stående 4:5 (1080×1350)" },
  landscape: { width: 1200, height: 630, label: "Liggende 1.91:1 (1200×630)" },
} as const;

export type ImageFormat = keyof typeof IMAGE_FORMATS;
export const IMAGE_FORMAT_KEYS = Object.keys(IMAGE_FORMATS) as ImageFormat[];
