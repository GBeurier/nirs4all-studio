/**
 * Shared fold/model hierarchy utilities used across Results, Predictions,
 * AggregatedResults, and other pages.
 *
 * Centralizes fold ordering, labeling, badge generation, score extraction,
 * and artifact availability logic.
 */

import type { PartitionPrediction } from "@/types/aggregated-predictions";

// ============================================================================
// Fold ordering
// ============================================================================

/** Sort priority for special fold IDs (lower = first). */
export const FOLD_ORDER: Record<string, number> = { final: 0, avg: 1, w_avg: 2 };

/** Sort PartitionPrediction rows: final → avg → w_avg → numbered folds, then by partition. */
export function foldSort(a: PartitionPrediction, b: PartitionPrediction): number {
  const aOrder = FOLD_ORDER[a.fold_id] ?? (100 + parseInt(a.fold_id || "999"));
  const bOrder = FOLD_ORDER[b.fold_id] ?? (100 + parseInt(b.fold_id || "999"));
  if (aOrder !== bOrder) return aOrder - bOrder;
  const partOrder = ["val", "test", "train"];
  return partOrder.indexOf(a.partition) - partOrder.indexOf(b.partition);
}

// ============================================================================
// Fold labels & colors
// ============================================================================

/** Human-readable label for a fold ID. */
export function foldLabel(foldId: string): string {
  if (foldId === "final") return "Final (refit)";
  if (foldId === "avg") return "Average";
  if (foldId === "w_avg") return "Weighted Avg";
  return `Fold ${foldId}`;
}

/** Short label for compact displays. */
export function foldLabelShort(foldId: string): string {
  if (foldId === "final") return "Refit";
  if (foldId === "avg") return "Avg";
  if (foldId === "w_avg") return "W-Avg";
  return `F${foldId}`;
}

/** Tailwind text color class for a fold ID. */
export function foldColorClass(foldId: string): string {
  if (foldId === "final") return "text-emerald-500";
  if (foldId === "avg" || foldId === "w_avg") return "text-chart-1";
  return "text-foreground/70";
}

/** Tailwind border/bg accent class for a fold ID. */
export function foldBadgeClasses(foldId: string): string {
  if (foldId === "final") return "border-emerald-500/30 text-emerald-500";
  if (foldId === "avg") return "border-chart-1/30 text-chart-1";
  if (foldId === "w_avg") return "border-indigo-500/30 text-indigo-500";
  return "";
}

// ============================================================================
// Fold type checks
// ============================================================================

export function isFinalFold(foldId: string): boolean {
  return foldId === "final";
}

export function isAggFold(foldId: string): boolean {
  return foldId === "avg" || foldId === "w_avg";
}

export function isNumberedFold(foldId: string): boolean {
  return !isFinalFold(foldId) && !isAggFold(foldId);
}

// ============================================================================
// Artifact helpers
// ============================================================================

/**
 * Map a fold_id to its expected key in fold_artifacts JSON.
 * - "final" → "fold_final" or "final"
 * - "0" → "fold_0"
 * - "avg" / "w_avg" → if ALL numbered folds have artifacts, these can predict
 */
export function foldArtifactKey(foldId: string): string {
  if (foldId === "final") return "fold_final";
  return `fold_${foldId}`;
}

/** Check if a specific fold has an artifact in the fold_artifacts dict. */
export function hasArtifactForFold(
  foldId: string,
  foldArtifacts: Record<string, string> | null | undefined,
): boolean {
  if (!foldArtifacts) return false;
  if (foldId === "final") {
    return !!(foldArtifacts["fold_final"] || foldArtifacts["final"]);
  }
  if (foldId === "avg" || foldId === "w_avg") {
    // Avg/w_avg can predict if all numbered fold models have artifacts
    return allNumberedFoldsHaveArtifacts(foldArtifacts);
  }
  return !!foldArtifacts[`fold_${foldId}`];
}

/** Check if all numbered fold models have artifacts (needed for avg/w_avg prediction). */
function allNumberedFoldsHaveArtifacts(foldArtifacts: Record<string, string>): boolean {
  const foldKeys = Object.keys(foldArtifacts).filter(k => /^fold_\d+$/.test(k));
  return foldKeys.length > 0;
}

/** Check if a chain has any usable artifact (refit or fold-level). */
export function chainHasAnyArtifact(foldArtifacts: Record<string, string> | null | undefined): boolean {
  if (!foldArtifacts) return false;
  return Object.keys(foldArtifacts).length > 0;
}

/** Check if a chain has a refit artifact specifically. */
export function chainHasRefitArtifact(foldArtifacts: Record<string, string> | null | undefined): boolean {
  if (!foldArtifacts) return false;
  return !!(foldArtifacts["fold_final"] || foldArtifacts["final"]);
}

// ============================================================================
// Score extraction from predictions
// ============================================================================

/** Safe number coercion. */
export function safeNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract metric scores from a PartitionPrediction for display.
 * Tries: scores JSON (flat or nested) → scalar fallbacks for primary metric.
 */
export function predictionScores(
  pred: PartitionPrediction,
  selectedMetrics: string[],
  metric: string | null,
): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  const pm = (metric || "rmse").toLowerCase();
  const scoresObj = pred.scores as Record<string, unknown> | null | undefined;

  for (const k of selectedMetrics) {
    const kl = k.toLowerCase();
    let val: number | null = null;

    if (scoresObj && typeof scoresObj === "object") {
      // 1. Try flat: scores[k]
      val = safeNumber(scoresObj[k]);
      // 2. Try nested partition-keyed: scores[partition][k]
      if (val == null) {
        for (const part of [pred.partition, "val", "test", "train"]) {
          const inner = scoresObj[part];
          if (inner && typeof inner === "object") {
            val = safeNumber((inner as Record<string, unknown>)[k]);
            if (val != null) break;
          }
        }
      }
    }
    // 3. Scalar fallback for primary metric
    if (val == null && (kl === pm || kl === "rmse")) {
      val = safeNumber(pred.val_score) ?? safeNumber(pred.test_score) ?? safeNumber(pred.train_score);
    }
    result[k] = val;
  }
  return result;
}

// ============================================================================
// Tree hierarchy builder
// ============================================================================

export interface FoldTreeNode {
  prediction: PartitionPrediction;
  isRoot: boolean;
  children: FoldTreeNode[];
}

/**
 * Build a tree from flat PartitionPrediction rows.
 *
 * For refitted chains (has fold_id="final"):
 *   Root = final, Children = [avg, w_avg, fold_0, fold_1, ...]
 *
 * For non-refitted chains:
 *   Root = avg (or first available), Children = [w_avg, fold_0, fold_1, ...]
 */
export function buildFoldTree(predictions: PartitionPrediction[]): FoldTreeNode | null {
  if (predictions.length === 0) return null;

  // Deduplicate: one row per fold_id (prefer val partition for display)
  const foldMap = new Map<string, PartitionPrediction>();
  const sorted = [...predictions].sort(foldSort);
  for (const pred of sorted) {
    if (!foldMap.has(pred.fold_id) || pred.partition === "val") {
      foldMap.set(pred.fold_id, pred);
    }
  }

  const hasFinal = foldMap.has("final");
  const rootFoldId = hasFinal ? "final" : (foldMap.has("avg") ? "avg" : sorted[0]?.fold_id);

  if (!rootFoldId) return null;

  const rootPred = foldMap.get(rootFoldId)!;
  const children: FoldTreeNode[] = [];

  // Child ordering: avg, w_avg, then numbered folds
  const childOrder = ["avg", "w_avg"];
  for (const fid of childOrder) {
    if (fid !== rootFoldId && foldMap.has(fid)) {
      children.push({ prediction: foldMap.get(fid)!, isRoot: false, children: [] });
    }
  }
  // Numbered folds
  for (const [fid, pred] of foldMap) {
    if (fid !== rootFoldId && !childOrder.includes(fid)) {
      children.push({ prediction: pred, isRoot: false, children: [] });
    }
  }

  return { prediction: rootPred, isRoot: true, children };
}
