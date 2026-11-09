import Link from "next/link";
import type { FacebookStatus } from "@/lib/types";
import { cx } from "./ui";
import { Icon } from "./icons";

const LABEL: Record<string, string> = {
  connected: "Tilkoblet",
  expired: "Utløpt – koble til på nytt",
  revoked: "Tilgang trukket tilbake",
  error: "Feil ved tilkobling",
};

export function FacebookStatusPill({ status, metaConfigured }: { status: FacebookStatus | null; metaConfigured: boolean }) {
  const ok = status?.connection_status === "connected";
  const text = !metaConfigured ? "Meta-app ikke konfigurert" : status ? LABEL[status.connection_status] ?? status.connection_status : "Ikke tilkoblet";
  return (
    <Link
      href="/innstillinger#facebook"
      className={cx(
        "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm ring-1 ring-inset",
        ok ? "bg-moss-50 text-moss-700 ring-moss-100" : "bg-amber-50 text-amber-900 ring-amber-200",
      )}
    >
      <Icon.facebook width={16} height={16} />
      <span className={cx("size-2 rounded-full", ok ? "bg-moss-500" : "bg-amber-500")} aria-hidden />
      {ok ? `${status!.page_name}` : text}
    </Link>
  );
}
