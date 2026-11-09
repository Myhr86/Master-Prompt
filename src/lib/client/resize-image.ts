/**
 * Skalerer ned bilder i nettleseren før opplasting (maks 2560 px, JPEG).
 * Mobilbilder er ofte 4–10 MB; Vercel tar bare imot ca. 4,5 MB per
 * forespørsel. Nedskalering gjør også opplastingen raskere på mobilnett.
 */
export const MAX_UPLOAD_EDGE = 2560;
const MAX_DIRECT_BYTES = 4 * 1024 * 1024;

export async function resizeForUpload(file: File, maxEdge = MAX_UPLOAD_EDGE): Promise<File> {
  if (!file.type.startsWith("image/")) throw new Error(`${file.name}: ikke et bilde`);
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    if (!blob) throw new Error("toBlob");
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    // Nettleseren kunne ikke lese bildet (f.eks. HEIC i enkelte nettlesere): send originalen hvis den er liten nok.
    if (file.size <= MAX_DIRECT_BYTES) return file;
    throw new Error(`${file.name}: kunne ikke gjøre bildet mindre. Prøv å lagre det som JPEG først.`);
  }
}
