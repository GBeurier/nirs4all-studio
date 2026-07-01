import { describe, expect, it } from "vitest";

import {
  buildPredictionCsv,
  buildPredictionExportRows,
  buildPredictionPreviewRows,
  formatPrediction,
  formatPredictionValue,
  parsePredictionCsvInput,
  type PredictionResult,
} from "../PredictDialogData";

function predictionResult(
  overrides: Partial<PredictionResult> = {}
): PredictionResult {
  return {
    predictions: [1.23456, 2000],
    model_id: "model-1",
    num_samples: 2,
    preprocessing_applied: [],
    ...overrides,
  };
}

describe("PredictDialogData", () => {
  it("parses numeric CSV, TSV, and semicolon rows while skipping headers", () => {
    expect(
      parsePredictionCsvInput(
        "w1,w2,w3\n1,2,3\n4; 5; 6\n7\t8\t9\nbad,10,11\n"
      )
    ).toEqual([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ]);
  });

  it("returns no rows when pasted text has no numeric spectra", () => {
    expect(parsePredictionCsvInput("sample,a,b\nfoo,bar,baz")).toEqual([]);
  });

  it("formats predictions with existing precision rules", () => {
    expect(formatPrediction(12.34567)).toBe("12.3457");
    expect(formatPrediction(1000)).toBe("1000.0");
    expect(formatPrediction(-1500.25)).toBe("-1500.3");
  });

  it("formats multi-output prediction values without scalar toFixed assumptions", () => {
    expect(formatPredictionValue([1.23456, 2000])).toBe("1.2346 | 2000.0");
  });

  it("builds formatted preview rows with signed differences", () => {
    const rows = buildPredictionPreviewRows(
      predictionResult({
        predictions: [2.34567, 3],
        actual_values: [1, 3.5],
      })
    );

    expect(rows).toMatchObject([
      {
        index: 1,
        prediction: "2.3457",
        actual: "1.0000",
        difference: "+1.3457",
      },
      {
        index: 2,
        prediction: "3.0000",
        actual: "3.5000",
        difference: "-0.5000",
      },
    ]);
    expect(rows[0].differenceValue).toBeCloseTo(1.34567);
    expect(rows[1].differenceValue).toBe(-0.5);
  });

  it("builds preview rows for multi-output predictions and actuals without scalar differences", () => {
    const rows = buildPredictionPreviewRows(
      predictionResult({
        predictions: [[2, 3.5], [4.25, 5]],
        actual_values: [[1.25, 3], [4, 5.5]],
      })
    );

    expect(rows).toMatchObject([
      {
        index: 1,
        prediction: "2.0000 | 3.5000",
        actual: "1.2500 | 3.0000",
        difference: null,
      },
      {
        index: 2,
        prediction: "4.2500 | 5.0000",
        actual: "4.0000 | 5.5000",
        difference: null,
      },
    ]);
    expect(rows[0].differenceValue).toBeNull();
  });

  it("builds export rows without actual values", () => {
    expect(buildPredictionExportRows(predictionResult())).toEqual([
      { index: 1, prediction: 1.23456 },
      { index: 2, prediction: 2000 },
    ]);
  });

  it("builds export rows with actual values and raw differences", () => {
    expect(
      buildPredictionExportRows(
        predictionResult({
          predictions: [2, 3.5],
          actual_values: [1.25, 4],
        })
      )
    ).toEqual([
      { index: 1, prediction: 2, actual: 1.25, difference: 0.75 },
      { index: 2, prediction: 3.5, actual: 4, difference: -0.5 },
    ]);
  });

  it("serializes predictions to the export CSV format", () => {
    expect(
      buildPredictionCsv(
        predictionResult({
          predictions: [2, 3.5],
          actual_values: [1.25, 4],
        })
      )
    ).toBe("Index,Prediction,Actual,Difference\n1,2,1.25,0.75\n2,3.5,4,-0.5\n");

    expect(buildPredictionCsv(predictionResult({ predictions: [4] }))).toBe(
      "Index,Prediction\n1,4\n"
    );
  });

  it("serializes multi-output predictions and actuals to separate CSV columns", () => {
    expect(
      buildPredictionCsv(
        predictionResult({
          predictions: [[2, 3.5], [4.25, 5]],
          actual_values: [[1.25, 3], [4, 5.5]],
        })
      )
    ).toBe("Index,Prediction_1,Prediction_2,Actual_1,Actual_2,Difference\n1,2,3.5,1.25,3,\n2,4.25,5,4,5.5,\n");
  });

  it("keeps CSV columns aligned when actual values are incomplete", () => {
    expect(
      buildPredictionCsv(
        predictionResult({
          predictions: [[2, 3.5], [4.25, 5]],
          actual_values: [[1.25, 3]],
        })
      )
    ).toBe("Index,Prediction_1,Prediction_2,Actual_1,Actual_2,Difference\n1,2,3.5,1.25,3,\n2,4.25,5,,,\n");
  });
});
