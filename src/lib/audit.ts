import "server-only";
import { createClient } from "./supabase/server";
import { createAdminClient } from "./supabase/admin";
import { log, redact } from "./logger";

export async function audit(
  action: string,
  opts: { actorId?: string | null; actorType?: "owner" | "system" | "cron"; entity?: string; entityId?: string; details?: Record<string, unknown> } = {},
) {
  const row = {
    actor_id: opts.actorId ?? null,
    actor_type: opts.actorType ?? "owner",
    action,
    entity: opts.entity ?? null,
    entity_id: opts.entityId ?? null,
    details: (redact(opts.details ?? {}) as Record<string, unknown>) ?? null,
  };
  try {
    const supabase = opts.actorType && opts.actorType !== "owner" ? createAdminClient() : await createClient();
    const { error } = await supabase.from("audit_log").insert(row);
    if (error) log.warn("audit.insert_failed", { action, error: error.message });
  } catch (err) {
    log.warn("audit.insert_failed", { action, error: err });
  }
  log.info(`audit.${action}`, { entity: row.entity, entityId: row.entity_id });
}
