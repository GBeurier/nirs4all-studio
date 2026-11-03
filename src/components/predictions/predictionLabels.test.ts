import i18next from "i18next";
import { beforeAll, describe, expect, it } from "vitest";

import fr from "@/locales/fr";
import {
  isPredictionOnlyPartition,
  partitionBadgeClass,
  PREDICTION_ONLY_BADGE_CLASS,
  scoredPartitionRows,
} from "@/lib/partitionColors";
import { getPartitionLabel } from "./predictionLabels";
import { initEnglishI18n } from "./predictionsTestI18n";

beforeAll(async () => {
  await initEnglishI18n();
});

describe("prediction-only partition (samples without a target)", () => {
  it("is recognised, labelled and badged distinctly from scored partitions", () => {
    expect(isPredictionOnlyPartition("prediction")).toBe(true);
    expect(isPredictionOnlyPartition("Prediction")).toBe(true);
    expect(isPredictionOnlyPartition("test")).toBe(false);
    expect(isPredictionOnlyPartition(null)).toBe(false);
    expect(getPartitionLabel(i18next.t, "prediction", "prediction")).toBe("Predicted (no target)");
    expect(getPartitionLabel(i18next.t, "test")).toBe("Test");
    expect(partitionBadgeClass("prediction")).toBe(PREDICTION_ONLY_BADGE_CLASS);
    expect(fr.predictions.partitions.prediction).toBe("Prédit (sans cible)");
  });

  it("is dropped from scored rows", () => {
    const rows = [{ partition: "test" }, { partition: "prediction" }, { partition: "train" }];
    expect(scoredPartitionRows(rows).map((row) => row.partition)).toEqual(["test", "train"]);
  });
});
