// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { PredictionRecord } from "@/types/linked-workspaces";
import { usePredictionRows } from "./usePredictionRows";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("prediction visibility without a refitted model", () => {
  const crossValidation: PredictionRecord = {
    id: "cv-fold-0", source_dataset: "spectra", source_file: "store.sqlite",
    dataset_name: "spectra", model_name: "PLSRegression", partition: "val",
    trace_id: "cv-chain", fold_id: "0", task_type: "regression", metric: "rmse",
    val_score: 0.2,
  };

  it("shows CV-only results on arrival without asking the user to discover a hidden filter", async () => {
    const root = createRoot(document.createElement("div"));
    let current!: ReturnType<typeof usePredictionRows>;
    function Consumer({ rows }: { rows: PredictionRecord[] }) {
      current = usePredictionRows(rows, "regression");
      return null;
    }
    try {
      await act(async () => root.render(createElement(Consumer, { rows: [] })));
      await act(async () => root.render(createElement(Consumer, { rows: [crossValidation] })));
      expect(current.pageRows).toHaveLength(1);
      expect(current.pageRows[0].cardType).toBe("train");
      expect(current.hasActiveFilters).toBe(false);
      await act(async () => current.setVisibleFoldTypes(["refits"]));
      expect(current.pageRows).toHaveLength(0);
      await act(async () => current.clearFilters());
      expect(current.pageRows).toHaveLength(1);
    } finally { await act(async () => root.unmount()); }
  });
});
