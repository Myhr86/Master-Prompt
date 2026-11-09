import { composeFacebookMessage } from "@/lib/posts/content-hash";

/** Tilnærmet forhåndsvisning av hvordan innlegget ser ut på Facebook. */
export function FacebookPreview({
  pageName,
  title,
  content,
  hashtags,
  linkUrl,
  imageUrl,
  isAiImage,
  when,
  video,
}: {
  pageName: string;
  title: string;
  content: string;
  hashtags: string[];
  linkUrl: string | null;
  imageUrl: string | null;
  isAiImage?: boolean;
  when?: string;
  /** Satt når innlegget har video (vises som video, og som Reel hvis den oppfyller kravene). */
  video?: { poster: string | null; reel: boolean };
}) {
  const message = composeFacebookMessage({ title, content, hashtags });
  const finalText = imageUrl && linkUrl && !message.includes(linkUrl) ? `${message}\n\n${linkUrl}` : message;
  let host = "";
  try {
    host = linkUrl ? new URL(linkUrl).hostname.replace(/^www\./, "").toUpperCase() : "";
  } catch {
    host = "";
  }
  return (
    <div className="overflow-hidden rounded-2xl bg-white text-[15px] text-[#050505] shadow-soft ring-1 ring-black/5" aria-label="Forhåndsvisning på Facebook">
      <div className="flex items-center gap-2.5 px-4 pt-3">
        <div className="flex size-10 items-center justify-center rounded-full bg-wood-700 font-display text-sm text-white">M</div>
        <div className="leading-tight">
          <p className="text-[15px] font-semibold">{pageName}</p>
          <p className="text-[13px] text-[#65676b]">{when ?? "Ikke planlagt"} · 🌐</p>
        </div>
      </div>
      <p className="whitespace-pre-line break-words px-4 pb-3 pt-2 leading-snug">{finalText || <span className="text-[#65676b]">(ingen tekst)</span>}</p>
      {imageUrl && video ? (
        <div className="relative bg-black">
          <video src={imageUrl} poster={video.poster ?? undefined} controls playsInline preload="metadata" className={video.reel ? "mx-auto max-h-[560px] aspect-[9/16]" : "max-h-[560px] w-full"} />
          <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">{video.reel ? "Publiseres som Reel" : "Publiseres som video"}</span>
        </div>
      ) : imageUrl ? (
        <div className="relative bg-[#f0f2f5]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="Bilde til innlegget" className="max-h-[560px] w-full object-cover" />
          {isAiImage && <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">AI-generert miljø</span>}
        </div>
      ) : linkUrl ? (
        <div className="mx-0 border-y border-[#dadde1] bg-[#f0f2f5] px-4 py-3">
          <p className="text-[12px] text-[#65676b]">{host}</p>
          <p className="font-semibold">{title || pageName}</p>
          <p className="text-[13px] text-[#65676b]">Forhåndsvisning av lenken hentes av Facebook ved publisering.</p>
        </div>
      ) : null}
      <div className="flex justify-around border-t border-[#ced0d4] px-4 py-1.5 text-[14px] font-semibold text-[#65676b]">
        <span>Liker</span>
        <span>Kommenter</span>
        <span>Del</span>
      </div>
    </div>
  );
}
