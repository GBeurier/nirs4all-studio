/**
 * Questions the main process asks a running sidecar about the scientific
 * host: did it start on the selected interpreter, and is it running anything.
 * `request` is the main process's authenticated fetch.
 */

import { samePythonPath } from "./python-discovery";

export type SidecarRequest = (url: string, init?: RequestInit) => Promise<Response>;

/** The sidecar's cold acquisition budget (180 s) plus a margin. */
const ACQUISITION_WAIT_MS = 200_000;
const ACQUISITION_POLL_MS = 500;

/** Plain words for the sidecar's host acquisition reason codes (`ml_error`); others are shown as codes. */
const HOST_FAILURE_REASONS: Record<string, string> = {
  studio_adapters_unavailable: "Studio's own Python adapters are missing from this installation",
  scientific_distribution_missing: "nirs4all is not installed in it",
  scientific_distribution_inconsistent: "the nirs4all installation in this environment is inconsistent; reinstall nirs4all or pick another environment",
  scientific_distribution_version_unsupported: "its nirs4all version is outside the range Studio requires",
  scientific_library_import_failed: "nirs4all is installed but could not be imported",
  python_host_windows_system_root_unavailable: "Windows did not give Python its system directory (SystemRoot)",
};

/**
 * Confirm that the sidecar at `url` loaded the scientific library from
 * `expectedPython`. Rejects with a user-facing reason.
 *
 * The sidecar acquires the host after it reports ready; readiness says
 * `ml_loading` until that ends. The coherence probe is only sent afterwards:
 * it imports nirs4all under a shorter limit than a cold acquisition, so asked
 * earlier it fails on a slow disk although the host would start.
 */
export async function confirmScientificHost(
  url: string,
  expectedPython: string,
  request: SidecarRequest,
  { waitMs = ACQUISITION_WAIT_MS, pollMs = ACQUISITION_POLL_MS } = {},
): Promise<void> {
  const deadline = Date.now() + waitMs;
  let response: Response;
  let readiness: { ml_ready?: boolean; ml_loading?: boolean; ml_error?: string };
  for (;;) {
    response = await request(`${url}/api/system/readiness`);
    readiness = await response.json() as typeof readiness;
    if (!response.ok || readiness.ml_loading !== true || Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  if (!response.ok || readiness.ml_ready !== true) {
    const code = readiness.ml_error;
    const reason = code ? `${HOST_FAILURE_REASONS[code] ?? "the sidecar reported"} (${code})` : "no reason was reported";
    throw new Error(`Studio could not start nirs4all in this Python environment: ${reason}.`);
  }
  const coherenceResponse = await request(`${url}/api/system/env-coherence`);
  const coherence = await coherenceResponse.json() as { coherent?: boolean; running_python?: string };
  if (!coherenceResponse.ok || coherence.coherent !== true || !coherence.running_python) {
    throw new Error("The analysis backend did not activate the selected Python environment.");
  }
  if (!samePythonPath(expectedPython, coherence.running_python)) {
    throw new Error("The analysis backend is using a different Python interpreter than the one you selected.");
  }
}

/**
 * A sentence about the pipeline runs queued or running in this session, as
 * the sidecar counts them for the active workspace, or null when there are
 * none. Short scientific requests (previews, explanations) are not tracked.
 */
export async function describeActiveRuns(url: string, request: SidecarRequest): Promise<string | null> {
  try {
    const response = await request(`${url}/api/runs/stats`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return null;
    const stats = await response.json() as { running?: number; queued?: number };
    const active = (stats.running ?? 0) + (stats.queued ?? 0);
    return active > 0 ? `${active === 1 ? "A run is" : `${active} runs are`} in progress.` : null;
  } catch {
    // An unresponsive sidecar is not running anything that a restart would lose.
    return null;
  }
}
