"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon } from "./icons";
import { BrandMark } from "./brand";
import { cx } from "./ui";

const MAIN = [
  { href: "/", label: "Oversikt", icon: Icon.home },
  { href: "/innlegg", label: "Innlegg", icon: Icon.posts },
  { href: "/generer", label: "Lag innlegg", icon: Icon.sparkles },
  { href: "/kalender", label: "Kalender", icon: Icon.calendar },
  { href: "/produkter", label: "Produkter", icon: Icon.box },
  { href: "/bilder", label: "Bildeverksted", icon: Icon.image },
  { href: "/analyse", label: "Analyse", icon: Icon.chart },
  { href: "/innstillinger", label: "Innstillinger", icon: Icon.settings },
];

const MOBILE = ["/", "/innlegg", "/generer", "/kalender"];

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}

export function AppNav({ email, signOut, pendingCount }: { email: string; signOut: () => Promise<void>; pendingCount: number }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Skrivebord: sidemeny */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-paper/80 px-4 py-6 backdrop-blur lg:flex">
        <Link href="/" className="px-2">
          <BrandMark />
        </Link>
        <nav className="mt-10 flex flex-1 flex-col gap-1" aria-label="Hovedmeny">
          {MAIN.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cx(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                isActive(path, item.href) ? "bg-wood-100 font-medium text-wood-900" : "text-ink-soft hover:bg-wood-50 hover:text-ink",
              )}
            >
              <item.icon />
              <span className="flex-1">{item.label}</span>
              {item.href === "/innlegg" && pendingCount > 0 && (
                <span className="rounded-full bg-amber-100 px-2 text-xs font-semibold text-amber-800">{pendingCount}</span>
              )}
            </Link>
          ))}
        </nav>
        <div className="border-t border-line pt-4">
          <p className="truncate px-3 text-xs text-ink-mute">{email}</p>
          <form action={signOut}>
            <button className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-ink-soft hover:bg-wood-50">
              <Icon.logout /> Logg ut
            </button>
          </form>
        </div>
      </aside>

      {/* Mobil: toppfelt */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-linen/90 px-4 py-3 backdrop-blur lg:hidden">
        <Link href="/">
          <BrandMark />
        </Link>
      </header>

      {/* Mobil: bunnmeny */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/95 backdrop-blur lg:hidden" aria-label="Mobilmeny">
        <ul className="grid grid-cols-5">
          {MAIN.filter((m) => MOBILE.includes(m.href)).map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cx("relative flex min-h-16 flex-col items-center justify-center gap-1 text-[11px]", isActive(path, item.href) ? "text-wood-800" : "text-ink-mute")}
              >
                {item.href === "/generer" ? (
                  <span className="-mt-1 flex size-10 items-center justify-center rounded-full bg-wood-700 text-white shadow-lift">
                    <item.icon />
                  </span>
                ) : (
                  <item.icon />
                )}
                <span>{item.href === "/generer" ? "Lag" : item.label}</span>
                {item.href === "/innlegg" && pendingCount > 0 && (
                  <span className="absolute right-[22%] top-2 min-w-4 rounded-full bg-amber-500 px-1 text-center text-[10px] font-semibold text-white">{pendingCount}</span>
                )}
              </Link>
            </li>
          ))}
          <li>
            <button onClick={() => setOpen(true)} className="flex min-h-16 w-full flex-col items-center justify-center gap-1 text-[11px] text-ink-mute" aria-expanded={open}>
              <Icon.menu />
              <span>Mer</span>
            </button>
          </li>
        </ul>
      </nav>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Mer">
          <button className="absolute inset-0 bg-ink/30" onClick={() => setOpen(false)} aria-label="Lukk meny" />
          <div className="safe-bottom absolute inset-x-0 bottom-0 rounded-t-3xl bg-paper p-5 shadow-lift">
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />
            <ul className="grid grid-cols-2 gap-2">
              {MAIN.filter((m) => !MOBILE.includes(m.href)).map((item) => (
                <li key={item.href}>
                  <Link href={item.href} onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-2xl bg-wood-50 px-4 py-4 text-sm text-ink">
                    <item.icon /> {item.label}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-5 truncate text-center text-xs text-ink-mute">{email}</p>
            <form action={signOut} className="mt-2">
              <button className="flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm text-ink-soft ring-1 ring-line">
                <Icon.logout /> Logg ut
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
