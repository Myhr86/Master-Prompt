import type { SVGProps } from "react";

function Base(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden width={20} height={20} {...props} />;
}

export const Icon = {
  home: (p: SVGProps<SVGSVGElement>) => (<Base {...p}><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></Base>),
  posts: (p: SVGProps<SVGSVGElement>) => (<Base {...p}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></Base>),
  sparkles: (p: SVGProps<SVGSVGElement>) => (<Base {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2" /></Base>),
  calendar: (p: SVGProps<SVGSVGElement>) => (<Base {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></Base>),
  box: (p: SVGProps<SVGSVGElement>) => (<Base {...p}><path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="m3 8 9 5 9-5M12 13v8" /></Base>),
  image: (p: SVGProps<SVGSVGElement>) => (<Base {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></Base>),
  brush: (p: SVGProps<SVGSVGElement>) => (<Base {...p}><path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L11 15.8l-3-3z" /><path d="M8 12.8c-2 0-3.5 1.6-3.5 3.6 0 1.5-.8 2.4-2 2.6 1 1.3 2.6 2 4.2 2 2.6 0 4.3-1.9 4.3-4.2" /></Base>),
  chart: (p: SVGProps<SVGSVGElement>) => (<Base {...p}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></Base>),
  settings: (p: SVGProps<SVGSVGElement>) => (<Base {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Base>),
  menu: (p: SVGProps<SVGSVGElement>) => (<Base {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Base>),
  check: (p: SVGProps<SVGSVGElement>) => (<Base {...p}><path d="m5 12 5 5L20 7" /></Base>),
  x: (p: SVGProps<SVGSVGElement>) => (<Base {...p}><path d="M6 6l12 12M18 6 6 18" /></Base>),
  facebook: (p: SVGProps<SVGSVGElement>) => (<Base {...p}><path d="M15 3h-2a4 4 0 0 0-4 4v3H7v4h2v7h4v-7h3l1-4h-4V7a1 1 0 0 1 1-1h2z" /></Base>),
  arrowRight: (p: SVGProps<SVGSVGElement>) => (<Base {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Base>),
  logout: (p: SVGProps<SVGSVGElement>) => (<Base {...p}><path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h10" /></Base>),
};
