import { Badge } from "./ui";
import { STATUS_LABEL, STATUS_TONE, type PostStatus } from "@/lib/posts/status";

export function StatusBadge({ status }: { status: PostStatus }) {
  return <Badge className={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}
