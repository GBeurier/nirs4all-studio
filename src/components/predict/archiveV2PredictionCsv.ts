import { csvEscape } from "@/components/predictions/viewer/export";
import type {
  ArchiveV2ArrayPredictionResponse,
  ArchiveV2ConformalPresentation,
  ConformalIntervalCell,
} from "@/types/archiveV2Prediction";

const CSV_HEADER = [
  "sample_id",
  "coverage",
  "target",
  "point_prediction",
  "lower",
  "upper",
  "interval_status",
] as const;

function csvCell(value: string | number): string {
  const safeValue = typeof value === "string" && /^[=+\-@]/.test(value) ? `'${value}` : value;
  return csvEscape(safeValue);
}

function exactStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function requirePredictionMatrix(result: ArchiveV2ArrayPredictionResponse): void {
  if (
    result.values.length !== result.sample_ids.length ||
    result.values.some((row) => row.length !== result.target_names.length)
  ) {
    throw new Error("Archive V2 prediction matrix does not match its sample and target identities.");
  }
}

function requireConformalAlignment(
  result: ArchiveV2ArrayPredictionResponse,
  conformal: ArchiveV2ConformalPresentation,
): void {
  if (
    !exactStrings(result.sample_ids, conformal.sample_ids) ||
    !exactStrings(result.sample_ids, conformal.interval_block.sample_ids) ||
    !exactStrings(result.target_names, conformal.target_names)
  ) {
    throw new Error("Conformal intervals are not exactly aligned with the prediction identities.");
  }
  if (
    conformal.interval_block.intervals.some(
      (interval) =>
        interval.cells.length !== result.sample_ids.length ||
        interval.cells.some((row) => row.length !== result.target_names.length),
    )
  ) {
    throw new Error("Conformal interval matrix does not match the prediction identities.");
  }
}

function intervalFields(cell: ConformalIntervalCell | null): [number | "", number | "", string] {
  if (cell == null) return ["", "", ""];
  if (cell.status === "unbounded") return ["", "", "unbounded"];
  return [cell.lower, cell.upper, "finite"];
}

export function buildArchiveV2PredictionCsv(
  result: ArchiveV2ArrayPredictionResponse,
  conformal: ArchiveV2ConformalPresentation | null,
): string {
  requirePredictionMatrix(result);
  if (conformal) requireConformalAlignment(result, conformal);

  const intervalSets = conformal?.interval_block.intervals ?? [null];
  const rows: string[] = [CSV_HEADER.map(csvCell).join(",")];
  for (const interval of intervalSets) {
    for (let sampleIndex = 0; sampleIndex < result.sample_ids.length; sampleIndex += 1) {
      for (let targetIndex = 0; targetIndex < result.target_names.length; targetIndex += 1) {
        const [lower, upper, status] = intervalFields(
          interval?.cells[sampleIndex][targetIndex] ?? null,
        );
        rows.push(
          [
            result.sample_ids[sampleIndex],
            interval?.coverage ?? "",
            result.target_names[targetIndex],
            result.values[sampleIndex][targetIndex],
            lower,
            upper,
            status,
          ]
            .map(csvCell)
            .join(","),
        );
      }
    }
  }
  return rows.join("\n");
}
