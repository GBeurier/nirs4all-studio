import { foldIdBase } from "@/lib/fold-utils";
import {
  canonicalMetricKey,
  getScoreMapValue,
  orderMetricKeys,
} from "@/lib/scores";
import { parseJsonRecord } from "@/lib/scoreValues";
import { projectPartitionScoreMaps } from "@/lib/score-adapters-fold-scores";
import type {
  ChainSummary,
  PartitionPrediction,
} from "@/types/aggregated-predictions";

export interface FoldGroup {
  foldId: string;
  baseFoldId: string;
  isAggregated: boolean;
  kind: "refit" | "cv" | "fold";
  rows: PartitionPrediction[];
  representative: PartitionPrediction | null;
}

const CV_PARTITIONS = ["val", "test", "train"] as const;
type CvPartition = (typeof CV_PARTITIONS)[number];

export interface CvMetricRow {
  metric: string;
  values: Record<CvPartition, number | null>;
}

export interface PipelineTreeNode {
  id: string;
  label: string;
  depth: number;
  kind: "step" | "branch" | "model";
  params: Array<[string, unknown]>;
  hasGenerator: boolean;
}

interface InitialFoldFocus {
  cardType?: string | null;
  foldId?: string | null;
  predictionId?: string | null;
}

const MODEL_STEP_TYPES = new Set(["model", "model_pls", "model_ensemble", "model_dl"]);

export function parseRecord(value: unknown): Record<string, unknown> | null {
  return parseJsonRecord(value);
}

export function buildFoldGroups(rows: PartitionPrediction[]): FoldGroup[] {
  const grouped = new Map<string, PartitionPrediction[]>();
  for (const row of rows) grouped.set(row.fold_id, [...(grouped.get(row.fold_id) ?? []), row]);
  return [...grouped.entries()]
    .map(([foldId, groupRows]) => {
      const baseFoldId = foldIdBase(foldId);
      const kind: FoldGroup["kind"] = baseFoldId === "final" || baseFoldId === "avg" || baseFoldId === "w_avg"
        ? (baseFoldId === "final" ? "refit" : "cv")
        : "fold";
      return {
        foldId,
        baseFoldId,
        isAggregated: foldId !== baseFoldId,
        kind,
        rows: sortRows(groupRows),
        representative: pickRepresentative(groupRows),
      };
    })
    .sort((a, b) => {
      const byFold = foldSortValue(a.foldId) - foldSortValue(b.foldId);
      if (byFold !== 0) return byFold;
      return Number(a.isAggregated) - Number(b.isAggregated);
    });
}

export function resolveInitialFoldId(
  rows: PartitionPrediction[],
  focus: InitialFoldFocus | undefined,
  summary: Pick<ChainSummary, "final_test_score">,
): string {
  if (focus?.predictionId) {
    const match = rows.find((row) => row.prediction_id === focus.predictionId);
    if (match) return match.fold_id;
  }
  if (focus?.foldId) {
    const exact = rows.find((row) => row.fold_id === focus.foldId);
    if (exact) return exact.fold_id;
    const base = foldIdBase(focus.foldId);
    const sameBase = rows.find((row) => foldIdBase(row.fold_id) === base);
    if (sameBase) return sameBase.fold_id;
  }
  if (focus?.cardType === "refit" || summary.final_test_score != null) {
    const finalRow = rows.find((row) => foldIdBase(row.fold_id) === "final");
    if (finalRow) return finalRow.fold_id;
  }
  const avgRow = rows.find((row) => foldIdBase(row.fold_id) === "avg");
  return avgRow?.fold_id ?? rows[0].fold_id;
}

export function summarize(values: number[]): { min: number; max: number; mean: number } | null {
  if (values.length === 0) return null;
  let min = values[0];
  let max = values[0];
  let sum = 0;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
  }
  return { min, max, mean: sum / values.length };
}

export function residualSummary(yTrue: number[], yPred: number[]): { mean: number; sigma: number } | null {
  const residuals: number[] = [];
  for (let i = 0; i < Math.min(yTrue.length, yPred.length); i += 1) residuals.push(yTrue[i] - yPred[i]);
  if (residuals.length === 0) return null;
  const mean = residuals.reduce((acc, value) => acc + value, 0) / residuals.length;
  const variance = residuals.reduce((acc, value) => acc + (value - mean) ** 2, 0) / residuals.length;
  return { mean, sigma: Math.sqrt(variance) };
}

export function buildCvMetricRows(
  cvScores: Record<string, Record<string, number>> | null | undefined,
  primaryMetric: string | null | undefined,
): CvMetricRow[] {
  if (!cvScores) return [];
  const scoreMaps = projectPartitionScoreMaps(cvScores as Record<string, unknown>);

  const discovered = new Set<string>();
  for (const metrics of [scoreMaps.valScores, scoreMaps.testScores, scoreMaps.trainScores]) {
    for (const [key, value] of Object.entries(metrics)) {
      const num = Number(value);
      if (!Number.isFinite(num)) continue;
      discovered.add(canonicalMetricKey(key) || key.trim().toLowerCase());
    }
  }

  const knownKeys = orderMetricKeys([...discovered]);
  const remainingKeys = [...discovered]
    .filter((key) => !knownKeys.includes(key))
    .sort((a, b) => a.localeCompare(b));
  const preferredKey = canonicalMetricKey(primaryMetric);
  const orderedKeys = [...new Set([
    ...(preferredKey ? [preferredKey] : []),
    ...knownKeys,
    ...remainingKeys,
  ])].filter((key) => discovered.has(key));

  return orderedKeys.map((metric) => ({
    metric,
    values: {
      val: getScoreMapValue(scoreMaps.valScores, metric),
      test: getScoreMapValue(scoreMaps.testScores, metric),
      train: getScoreMapValue(scoreMaps.trainScores, metric),
    },
  }));
}

export function resolvePrimaryCvMetric(
  primaryMetric: string | null | undefined,
  cvMetricRows: CvMetricRow[],
): string {
  return canonicalMetricKey(primaryMetric) || cvMetricRows[0]?.metric || "score";
}

export function parseGeneratorChoices(value: unknown): Array<Record<string, unknown>> | null {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed)) return null;
  const arr = parsed.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item));
  return arr.length > 0 ? arr : null;
}

export function buildPipelineTreeWithParams(
  steps: unknown[] | null | undefined,
  limit: number,
): { nodes: PipelineTreeNode[]; total: number } {
  const nodes: PipelineTreeNode[] = [];
  let total = 0;
  function visit(list: unknown[] | undefined, depth: number): void {
    if (!Array.isArray(list)) return;
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const step = raw as {
        id?: string;
        type?: string;
        name?: string;
        displayName?: string;
        params?: Record<string, unknown>;
        generator?: unknown;
        paramSweeps?: unknown;
        children?: unknown[];
        branches?: unknown[][];
      };
      total += 1;
      if (nodes.length < limit) {
        const type = step.type ?? "step";
        const label = step.displayName || step.name || type;
        const kind: PipelineTreeNode["kind"] =
          type === "branch" || type === "choice"
            ? "branch"
            : MODEL_STEP_TYPES.has(type)
            ? "model"
            : "step";
        const paramsObj = step.params && typeof step.params === "object" ? step.params : {};
        const paramsEntries = Object.entries(paramsObj).filter(([, v]) => v !== undefined && v !== null && v !== "");
        nodes.push({
          id: step.id ?? `${depth}-${nodes.length}`,
          label,
          depth,
          kind,
          params: paramsEntries,
          hasGenerator: !!step.generator || !!step.paramSweeps,
        });
      }
      if (Array.isArray(step.branches)) {
        for (const branch of step.branches) visit(branch, depth + 1);
      }
      if (Array.isArray(step.children)) visit(step.children, depth + 1);
    }
  }
  visit(steps ?? undefined, 0);
  return { nodes, total };
}

export function formatBranchPath(value: unknown): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return value.map((v) => String(v)).join(" -> ");
  }
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

function pickRepresentative(rows: PartitionPrediction[]): PartitionPrediction | null {
  return rows.find((row) => row.partition === "test")
    ?? rows.find((row) => row.partition === "val")
    ?? rows.find((row) => row.partition === "train")
    ?? rows[0]
    ?? null;
}

function sortRows(rows: PartitionPrediction[]): PartitionPrediction[] {
  const order: Record<string, number> = { val: 0, test: 1, train: 2 };
  return [...rows].sort((a, b) => (order[a.partition] ?? 99) - (order[b.partition] ?? 99));
}

function foldSortValue(foldId: string): number {
  const base = foldIdBase(foldId);
  if (base === "final") return 0;
  if (base === "avg") return 1;
  if (base === "w_avg") return 2;
  const parsed = Number.parseInt(base, 10);
  return Number.isFinite(parsed) ? 100 + parsed : 1000;
}
