/** @vitest-environment jsdom */
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import "@/lib/i18n";
import { CategoricalPredictResults } from "./CategoricalPredictResults";
import { buildConfusionMatrixFromVectors } from "@/components/runs/modelDetailClassification";

it("preserves original Coffee labels, library metrics and sample identities", () => {
  const markup = renderToStaticMarkup(<CategoricalPredictResults onReset={() => {}} result={{
    predictions: ["Tauro", "Renzo", "Tauro"], actual_values: ["Tauro", "Tauro", "Tauro"],
    num_samples: 3, model_name: "Coffee RF", preprocessing_steps: [], sample_ids: ["held-out-1", "held-out-2", "held-out-3"], metrics: { balanced_accuracy: 2 / 3 },
  }} />);
  expect(markup).toContain("Tauro");
  expect(markup).toContain("Renzo");
  expect(markup).toContain("held-out-3");
  expect(markup).toContain("Confusion matrix");
  expect(markup).toContain("0.6667");
  expect(markup).not.toContain("Mean");
});

it("keeps distinct confusion cells for labels containing separators and empty labels", () => {
  const result = buildConfusionMatrixFromVectors({ yTrue: ["a|b", "a", ""], yPred: ["c", "b|c", ""], normalize: "none", partitionLabel: "test" });
  expect(result.total_samples).toBe(3);
  expect(result.cells.find(cell => cell.true_label === "a|b" && cell.pred_label === "c")?.count).toBe(1);
  expect(result.cells.find(cell => cell.true_label === "a" && cell.pred_label === "b|c")?.count).toBe(1);
});
