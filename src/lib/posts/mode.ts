import "server-only";
import { env } from "../env";

/**
 * Faktisk publiseringsmodus. Ekte publisering krever BÅDE at serveren er
 * satt opp med PUBLISH_MODE=live OG at testmodus er slått av i innstillingene.
 */
export function effectivePublishMode(settingsTestMode: boolean): "live" | "simulated" {
  return env().PUBLISH_MODE === "live" && !settingsTestMode ? "live" : "simulated";
}
