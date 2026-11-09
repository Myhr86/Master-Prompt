export const POST_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "SCHEDULED",
  "PUBLISHING",
  "PUBLISHED",
  "REJECTED",
  "FAILED",
] as const;

export type PostStatus = (typeof POST_STATUSES)[number];

export const STATUS_LABEL: Record<PostStatus, string> = {
  DRAFT: "Utkast",
  PENDING_APPROVAL: "Venter på godkjenning",
  APPROVED: "Godkjent",
  SCHEDULED: "Planlagt",
  PUBLISHING: "Publiseres …",
  PUBLISHED: "Publisert",
  REJECTED: "Avvist",
  FAILED: "Feilet",
};

/** Tailwind-klasser for statusmerker */
export const STATUS_TONE: Record<PostStatus, string> = {
  DRAFT: "bg-stone-100 text-stone-700 ring-stone-200",
  PENDING_APPROVAL: "bg-amber-50 text-amber-800 ring-amber-200",
  APPROVED: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  SCHEDULED: "bg-sky-50 text-sky-800 ring-sky-200",
  PUBLISHING: "bg-violet-50 text-violet-800 ring-violet-200",
  PUBLISHED: "bg-wood-100 text-wood-800 ring-wood-200",
  REJECTED: "bg-rose-50 text-rose-700 ring-rose-200",
  FAILED: "bg-red-50 text-red-700 ring-red-200",
};

export const EDITABLE_STATUSES: PostStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SCHEDULED", "REJECTED", "FAILED"];
export const APPROVABLE_STATUSES: PostStatus[] = ["DRAFT", "PENDING_APPROVAL", "REJECTED"];
export const PUBLISHABLE_STATUSES: PostStatus[] = ["APPROVED", "SCHEDULED", "FAILED"];
export const DELETABLE_STATUSES: PostStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SCHEDULED", "REJECTED", "FAILED"];
