export interface PredictionResult {
  predictions: number[];
  model_id: string;
  num_samples: number;
  preprocessing_applied: string[];
  actual_values?: number[];
  metrics?: {
    r2?: number;
    rmse?: number;
    mae?: number;
  };
}

export type PredictInputMode = "paste" | "upload" | "dataset";

export interface PredictionPreviewRow {
  index: number;
  prediction: string;
  actual: string | null;
  difference: string | null;
  differenceValue: number | null;
}

export interface PredictionExportRow {
  index: number;
  prediction: number;
  actual?: number;
  difference?: number;
}

export function parsePredictionCsvInput(text: string): number[][] {
  const lines = text.trim().split("\n");
  const data: number[][] = [];

  for (const line of lines) {
    const values = line.split(/[,;\t]/).map((value) => value.trim());
    const numericValues = values.map((value) => parseFloat(value));

    if (numericValues.every((value) => !Number.isNaN(value))) {
      data.push(numericValues);
    }
  }

  return data;
}

export function formatPrediction(value: number): string {
  if (Math.abs(value) >= 1000) {
    return value.toFixed(1);
  }
  return value.toFixed(4);
}

export function hasActualValues(result: PredictionResult): boolean {
  return Boolean(result.actual_values && result.actual_values.length > 0);
}

export function buildPredictionPreviewRows(
  result: PredictionResult,
  limit = 20
): PredictionPreviewRow[] {
  const includeActual = hasActualValues(result);

  return result.predictions.slice(0, limit).map((prediction, index) => {
    const actual = includeActual ? result.actual_values![index] : null;
    const difference = actual !== null ? prediction - actual : null;

    return {
      index: index + 1,
      prediction: formatPrediction(prediction),
      actual: actual !== null ? formatPrediction(actual) : null,
      difference:
        difference !== null
          ? `${difference > 0 ? "+" : ""}${formatPrediction(difference)}`
          : null,
      differenceValue: difference,
    };
  });
}

export function buildPredictionExportRows(
  result: PredictionResult
): PredictionExportRow[] {
  const includeActual = hasActualValues(result);

  return result.predictions.map((prediction, index) => {
    if (!includeActual) {
      return {
        index: index + 1,
        prediction,
      };
    }

    const actual = result.actual_values![index];

    return {
      index: index + 1,
      prediction,
      actual,
      difference: prediction - actual,
    };
  });
}

export function buildPredictionCsv(result: PredictionResult): string {
  const includeActual = hasActualValues(result);
  const rows = buildPredictionExportRows(result);
  let csv = includeActual ? "Index,Prediction,Actual,Difference\n" : "Index,Prediction\n";

  for (const row of rows) {
    if (includeActual) {
      csv += `${row.index},${row.prediction},${row.actual},${row.difference}\n`;
    } else {
      csv += `${row.index},${row.prediction}\n`;
    }
  }

  return csv;
}
