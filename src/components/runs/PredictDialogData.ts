export interface PredictionResult {
  predictions: PredictionValue[];
  model_id: string;
  num_samples: number;
  preprocessing_applied: string[];
  actual_values?: PredictionValue[];
  metrics?: {
    r2?: number;
    rmse?: number;
    mae?: number;
  };
}

export type PredictionValue = number | number[];

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
  prediction: PredictionValue;
  actual?: PredictionValue;
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

export function formatPredictionValue(value: PredictionValue): string {
  if (Array.isArray(value)) {
    return value.map((item) => formatPrediction(item)).join(" | ");
  }
  return formatPrediction(value);
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
    const actual = includeActual ? result.actual_values![index] ?? null : null;
    const difference =
      actual !== null && !Array.isArray(prediction) && !Array.isArray(actual)
        ? prediction - actual
        : null;

    return {
      index: index + 1,
      prediction: formatPredictionValue(prediction),
      actual: actual !== null ? formatPredictionValue(actual) : null,
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
      difference: Array.isArray(prediction) || Array.isArray(actual) ? undefined : prediction - actual,
    };
  });
}

export function buildPredictionCsv(result: PredictionResult): string {
  const includeActual = hasActualValues(result);
  const rows = buildPredictionExportRows(result);
  const outputCount = getPredictionOutputCount(result.predictions);
  const actualOutputCount = includeActual
    ? getPredictionOutputCount(result.actual_values ?? [])
    : 0;
  const predictionHeaders =
    outputCount === 1
      ? ["Prediction"]
      : Array.from({ length: outputCount }, (_, index) => `Prediction_${index + 1}`);
  const actualHeaders =
    !includeActual
      ? []
      : actualOutputCount === 1
        ? ["Actual", "Difference"]
        : [
            ...Array.from(
              { length: actualOutputCount },
              (_, index) => `Actual_${index + 1}`
            ),
            "Difference",
          ];
  const headers = [
    "Index",
    ...predictionHeaders,
    ...actualHeaders,
  ];
  let csv = `${headers.join(",")}\n`;

  for (const row of rows) {
    const predictionCells = predictionValueToCsvCells(row.prediction, outputCount);
    const actualCells =
      includeActual
        ? predictionValueToCsvCells(row.actual, actualOutputCount)
        : [];
    const values = [
      String(row.index),
      ...predictionCells,
      ...(includeActual ? [...actualCells, csvValue(row.difference)] : []),
    ];
    csv += `${values.join(",")}\n`;
  }

  return csv;
}

function getPredictionOutputCount(predictions: PredictionValue[]): number {
  return Math.max(
    1,
    ...predictions.map((prediction) =>
      Array.isArray(prediction) ? prediction.length : 1
    )
  );
}

function predictionValueToCsvCells(value: PredictionValue | undefined, outputCount: number): string[] {
  const values = value === undefined ? [] : Array.isArray(value) ? value : [value];
  return Array.from({ length: outputCount }, (_, index) => csvValue(values[index]));
}

function csvValue(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}
