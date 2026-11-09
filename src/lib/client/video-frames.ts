import { frameTimes } from "../media/video";

/**
 * Leser lengde og format fra en video og tar ut noen stillbilder (JPEG) i
 * nettleseren. Brukes til miniatyrbilde og til at Claude kan beskrive videoen.
 * Returnerer tomme stillbilder hvis nettleseren ikke kan spille av formatet
 * (f.eks. HEVC i enkelte nettlesere) – videoen kan likevel lastes opp.
 */
export async function extractVideoInfo(file: File, count = 5): Promise<{ duration: number | null; width: number | null; height: number | null; frames: Blob[] }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("kan ikke lese video"));
      setTimeout(() => reject(new Error("tidsavbrudd")), 15_000);
    });
    const duration = Number.isFinite(video.duration) ? video.duration : null;
    const width = video.videoWidth || null;
    const height = video.videoHeight || null;
    const frames: Blob[] = [];
    if (duration && width && height) {
      const scale = Math.min(1, 1024 / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext("2d");
      for (const t of frameTimes(duration, count)) {
        await new Promise<void>((resolve) => {
          const done = () => resolve();
          video.onseeked = done;
          setTimeout(done, 4000);
          video.currentTime = Math.min(t, Math.max(0, duration - 0.05));
        });
        ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
        if (blob && blob.size > 1000) frames.push(blob);
      }
    }
    return { duration, width, height, frames };
  } catch {
    return { duration: null, width: null, height: null, frames: [] };
  } finally {
    URL.revokeObjectURL(url);
  }
}
