import {
  ALL_CLASSIFICATION_METRICS,
  ALL_REGRESSION_METRICS,
  extractScoreValue,
} from "@/lib/scores";

export type ScoreMapSource = Record<string, unknown> | null | undefined;

export interface FinalScoreMaps {
  testScores: Record<string, number | null>;
  trainScores: Record<string, number | null>;
}

const KNOWN_SCORE_METRIC_KEYS = [
  ...new Set([
    ...ALL_REGRESSION_METRICS.map(metric => metric.key),
    ...ALL_CLASSIFICATION_METRICS.map(metric => metric.key),
  ]),
];

function appendMetricKeys(
  keys: Set<string>,
  map: ScoreMapSource,
): void {
  if (!map || typeof map !== "object" || Array.isArray(map)) return;

  for (const [key, value] of Object.entries(map)) {
    if (
      (key === "test" || key === "val" || key === "train")
      && value
      && typeof value === "object"
      && !Array.isArray(value)
    ) {
      for (const nestedKey of Object.keys(value as Record<string, unknown>)) {
        keys.add(nestedKey);
      }
      continue;
    }

    keys.add(key);
  }
}

export function collectScoreMetricKeys(...maps: ScoreMapSource[]): string[] {
  const keys = new Set(KNOWN_SCORE_METRIC_KEYS);
  for (const map of maps) {
    appendMetricKeys(keys, map);
  }
  return [...keys];
}

export function projectFinalScoreMaps(
  source: ScoreMapSource,
  ...extraMetricSources: ScoreMapSource[]
): FinalScoreMaps {
  const finalTestScores: Record<string, number | null> = {};
  const finalTrainScores: Record<string, number | null> = {};
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return { testScores: finalTestScores, trainScores: finalTrainScores };
  }

  for (const key of collectScoreMetricKeys(...extraMetricSources, source)) {
    finalTestScores[key] = extractScoreValue(source, key, "test");
    finalTrainScores[key] = extractScoreValue(source, key, "train");
  }

  return { testScores: finalTestScores, trainScores: finalTrainScores };
}
