import type { PredictionArrayPayload } from "@/types/aggregated-predictions";

/** Keep sample rows intact: output selection never flattens or mixes targets. */
export function predictionOutputCount(payload: PredictionArrayPayload | null | undefined): number {
  if (!payload?.length) return 0;
  const matrix = Array.isArray(payload[0]);
  const count = matrix ? (payload[0] as number[]).length : 1;
  if (!count || payload.some(row => Array.isArray(row) !== matrix || (Array.isArray(row) && row.length !== count))) {
    throw new Error("Prediction arrays must be rectangular sample-by-output matrices");
  }
  return count;
}

export function coercePredictionVector(payload: PredictionArrayPayload | null | undefined, outputIndex = 0): number[] {
  if (!payload?.length) return [];
  const count = predictionOutputCount(payload);
  if (!Number.isInteger(outputIndex) || outputIndex < 0 || outputIndex >= count) {
    throw new Error(`Output ${outputIndex + 1} is unavailable in these prediction arrays`);
  }
  return payload.map(row => {
    const value = Array.isArray(row) ? row[outputIndex] : row;
    return typeof value === "number" ? value : Number.NaN;
  });
}
