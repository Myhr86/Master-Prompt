export const CONTEST_STATUS: Record<string, { label: string; tone: string }> = {
  utkast: { label: "Under arbeid", tone: "bg-stone-100 text-stone-700 ring-stone-200" },
  aktiv: { label: "Aktiv", tone: "bg-moss-50 text-moss-700 ring-moss-100" },
  avsluttet: { label: "Avsluttet", tone: "bg-amber-50 text-amber-800 ring-amber-200" },
  trukket: { label: "Vinner trukket", tone: "bg-wood-100 text-wood-800 ring-wood-200" },
  avlyst: { label: "Avlyst", tone: "bg-rose-50 text-rose-700 ring-rose-200" },
};

/** Om fristen har gått ut (beregnet på serveren ved hver forespørsel). */
export function hasEnded(endsAt: string, now: Date = new Date()): boolean {
  return new Date(endsAt).getTime() <= now.getTime();
}
