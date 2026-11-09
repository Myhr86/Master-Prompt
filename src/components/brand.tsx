export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg viewBox="0 0 64 64" className="size-9 shrink-0" aria-hidden>
        <rect width="64" height="64" rx="16" fill="#6b472a" />
        <path d="M14 46V20l9 14 9-14v26M38 20l6 11 6-11M44 31v15" fill="none" stroke="#faf7f2" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="leading-tight">
        <span className="block font-display text-[15px] font-semibold text-ink">Myhr Tre og Design</span>
        <span className="block whitespace-nowrap text-[10px] uppercase tracking-[0.12em] text-ink-mute">Social Media Manager</span>
      </span>
    </span>
  );
}
