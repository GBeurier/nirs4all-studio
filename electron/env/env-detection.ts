/**
 * Detection of the Python environments on this machine.
 *
 * Candidate interpreters come from `python-discovery`; each one gets a single
 * metadata inventory (bounded parallelism) and a report. Results are sorted,
 * de-duplicated by environment root and kept in a short in-memory cache,
 * because the settings page can ask several times in a row.
 */

import { createHash } from "node:crypto";

import type { PythonEnvKind, PythonEnvReport } from "../../src/types/pythonEnvironment";
import { evaluateInventory, takeInventory } from "./inventory";
import { canonicalPythonPath, gatherPythonCandidates, normalizeDetectedPath } from "./python-discovery";
import { getVenvPythonPath } from "./runtime-paths";

const DETECTION_TTL_MS = 30_000;
/** Interpreters inspected at once: enough to be quick, few enough not to stall a busy disk. */
const INVENTORY_CONCURRENCY = 4;

let detectionCache: { key: string; expiresAt: number; result: PythonEnvReport[] } | null = null;

/** Forget the cached detection after packages or the selection changed. */
export function clearDetectionCache(): void {
  detectionCache = null;
}

export interface DetectionContext {
  /** Directory of the environment Studio creates in its data directory. */
  studioEnvDir: string;
  selectedPythonPath: string | null;
}

const KIND_ORDER: Record<PythonEnvKind, number> = { studio: 0, conda: 1, venv: 2, system: 3 };

/**
 * Order: the selected environment, then usable ones, writable ones, the kind,
 * the newest Python and finally the path as a stable tiebreak.
 */
export function compareReports(selectedPythonPath: string | null, left: PythonEnvReport, right: PythonEnvReport): number {
  // Reports carry canonical paths, so the selected one is equal as a string.
  const isSelected = (report: PythonEnvReport) => Number(report.pythonPath === selectedPythonPath);
  return isSelected(right) - isSelected(left)
    || Number(right.usable) - Number(left.usable)
    || Number(right.writable) - Number(left.writable)
    || KIND_ORDER[left.kind] - KIND_ORDER[right.kind]
    || right.pythonVersion.localeCompare(left.pythonVersion, undefined, { numeric: true })
    || left.envRoot.localeCompare(right.envRoot, undefined, { numeric: true, sensitivity: "base" });
}

async function mapBounded<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Report every Python 3.11+ environment found on this machine, the selected one first. */
export async function detectEnvironments(context: DetectionContext, refresh = false): Promise<PythonEnvReport[]> {
  const key = createHash("sha1")
    .update([
      process.cwd(), process.env.PATH ?? "", process.env.CONDA_EXE ?? "", process.env.PYENV_ROOT ?? "",
      JSON.stringify(context),
    ].join("\u0000"))
    .digest("hex");
  if (!refresh && detectionCache && detectionCache.key === key && detectionCache.expiresAt > Date.now()) {
    return detectionCache.result.slice();
  }

  const candidates = await gatherPythonCandidates([
    context.selectedPythonPath,
    getVenvPythonPath(context.studioEnvDir),
  ]);
  const reports = (await mapBounded(candidates, INVENTORY_CONCURRENCY, async (candidate) => {
    const pythonPath = canonicalPythonPath(candidate, context.selectedPythonPath);
    try {
      return evaluateInventory(pythonPath, await takeInventory(pythonPath), context.studioEnvDir);
    } catch {
      // Not a usable Python 3.11+ interpreter: it is simply not listed.
      return null;
    }
  })).filter((report): report is PythonEnvReport => report !== null);

  const result: PythonEnvReport[] = [];
  const seenRoots = new Set<string>();
  for (const report of reports.sort((left, right) => compareReports(context.selectedPythonPath, left, right))) {
    const root = normalizeDetectedPath(report.envRoot);
    if (seenRoots.has(root)) continue;
    seenRoots.add(root);
    result.push(report);
  }

  detectionCache = { key, expiresAt: Date.now() + DETECTION_TTL_MS, result: result.slice() };
  return result;
}
