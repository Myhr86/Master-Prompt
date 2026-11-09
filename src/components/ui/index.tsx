import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-wood-700 text-white hover:bg-wood-800 shadow-soft",
  secondary: "bg-paper text-ink ring-1 ring-inset ring-line hover:bg-wood-50",
  ghost: "text-ink-soft hover:bg-wood-50 hover:text-ink",
  danger: "bg-paper text-red-700 ring-1 ring-inset ring-red-200 hover:bg-red-50",
  success: "bg-moss-600 text-white hover:bg-moss-700 shadow-soft",
};
const BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full px-4 min-h-11 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none select-none";

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={cx(BASE, VARIANTS[variant], className)} {...props} />;
}

export function ButtonLink({ variant = "primary", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cx(BASE, VARIANTS[variant], className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("rounded-card bg-paper ring-1 ring-line shadow-soft", className)} {...props} />;
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="mb-1 text-xs font-medium uppercase tracking-[0.14em] text-wood-600">{eyebrow}</p>}
        <h1 className="text-3xl text-ink sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-ink-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-ink-mute">{hint}</p>}
    </div>
  );
}

const INPUT =
  "w-full rounded-xl bg-white px-3.5 py-2.5 text-base sm:text-sm text-ink ring-1 ring-inset ring-line placeholder:text-ink-mute focus:outline-none focus:ring-2 focus:ring-wood-400";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(INPUT, "min-h-11", className)} {...props} />;
}
export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(INPUT, "leading-relaxed", className)} {...props} />;
}
export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cx(INPUT, "min-h-11 pr-8", className)} {...props} />;
}

export function Badge({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", className)}
      {...props}
    />
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-wood-200 bg-wood-50/50 px-6 py-10 text-center">
      <p className="font-display text-xl text-ink">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-ink-soft">{children}</div>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warn" | "error" | "success"; title?: string; children: ReactNode }) {
  const tones = {
    info: "bg-wood-50 ring-wood-200 text-wood-900",
    warn: "bg-amber-50 ring-amber-200 text-amber-900",
    error: "bg-red-50 ring-red-200 text-red-900",
    success: "bg-moss-50 ring-moss-100 text-moss-700",
  } as const;
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cx("rounded-2xl px-4 py-3 text-sm ring-1 ring-inset", tones[tone])}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? "mt-0.5" : ""}>{children}</div>
    </div>
  );
}
