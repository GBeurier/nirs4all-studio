import { api } from "@/api/transport";

export interface ScientificReadiness {
  ml_ready?: boolean;
  ml_loading?: boolean;
  ml_error?: string | null;
}

/** The sidecar's cold acquisition budget (180 s) plus a margin. */
const ACQUISITION_WAIT_MS = 200_000;
const POLL_INTERVAL_MS = 1_000;

/**
 * Read `/system/readiness`, waiting while the sidecar is still acquiring the
 * scientific host (`ml_loading`). Rust starts that acquisition after it is
 * ready, so a fresh start or an environment switch reports loading first;
 * deciding on that answer would mistake a starting engine for a broken one.
 */
export async function waitForScientificReadiness(
  read: () => Promise<ScientificReadiness> = () => api.get<ScientificReadiness>("/system/readiness"),
  { timeoutMs = ACQUISITION_WAIT_MS, intervalMs = POLL_INTERVAL_MS }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<ScientificReadiness> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const readiness = await read();
    if (readiness?.ml_loading !== true || Date.now() >= deadline) return readiness;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
