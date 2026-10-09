import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { getPartitionLabel } from "@/components/predictions/predictionLabels";
import { exportRowsCsv } from "./export";
import type { PartitionDataset } from "./types";

interface Props {
  datasets: PartitionDataset[];
  outputCount: number;
  outputIndex: number;
  onOutputChange: (index: number) => void;
}

function predictionRows(datasets: PartitionDataset[], outputIndex: number, limit = Infinity) {
  const rows = [];
  for (const dataset of datasets) {
    for (let index = 0; index < dataset.yPred.length; index++) {
      if (rows.length >= limit) return rows;
      const predicted = dataset.yPred[index];
      rows.push({ output: `Output ${outputIndex + 1}`, partition: dataset.label,
        sample: dataset.sampleIds?.[index] ?? index,
        actual: Number.isFinite(dataset.yTrue[index]) ? dataset.yTrue[index] : null,
        predicted: Number.isFinite(predicted) ? predicted : null });
    }
  }
  return rows;
}

/** Shared, keyboard-accessible output selection and exact chart data. */
export function PredictionOutputSelector({ datasets, outputCount, outputIndex, onOutputChange }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const sampleCount = datasets.reduce((count, dataset) => count + dataset.yPred.length, 0);
  const rows = useMemo(() => predictionRows(datasets, outputIndex, 20), [datasets, outputIndex]);
  if (!rows.length) return null;
  return <div className="border-b px-5 py-2 text-xs space-y-2">
    {outputCount > 1 && <div className="flex items-center gap-2">
      <label htmlFor={id}>{t("predictions.viewer.output.label")}</label>
      <select id={id} value={outputIndex} onChange={event => onOutputChange(Number(event.target.value))}
        className="rounded border bg-background px-2 py-1 text-foreground">
        {Array.from({ length: outputCount }, (_, index) => <option key={index} value={index}>{t("predictions.viewer.output.option", { n: index + 1 })}</option>)}
      </select>
      <span>{t("predictions.viewer.output.ofTotal", { count: outputCount })}</span>
    </div>}
    <p aria-live="polite">{t(outputCount > 1 ? "predictions.viewer.output.valueCountForOutput" : "predictions.viewer.output.valueCount", { count: sampleCount, n: outputIndex + 1 })}
      {outputCount > 1 && ` ${t("predictions.viewer.output.chartsNote")}`}</p>
    <details>
      <summary className="cursor-pointer">{t("predictions.viewer.output.viewValues", { count: Math.min(20, rows.length) })}</summary>
      <p>{t("predictions.viewer.output.missingNote")}</p>
      <div className="max-h-40 overflow-auto">
        <table className="w-full text-left">
          <caption>{t("predictions.viewer.output.caption", { n: outputIndex + 1 })}</caption>
          <thead><tr><th scope="col">{t("predictions.viewer.output.partition")}</th><th scope="col">{t("predictions.viewer.output.sample")}</th><th scope="col">{t("predictions.viewer.output.actual")}</th><th scope="col">{t("predictions.viewer.output.predicted")}</th></tr></thead>
          <tbody>{rows.slice(0, 20).map((row, index) => <tr key={index}>
            <td>{getPartitionLabel(t, row.partition)}</td><td>{row.sample}</td><td>{row.actual ?? "—"}</td><td>{row.predicted ?? "—"}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <Button variant="outline" size="sm" onClick={() => exportRowsCsv(predictionRows(datasets, outputIndex),
        ["output", "partition", "sample", "actual", "predicted"], `predictions_output-${outputIndex + 1}.csv`)}>
        {t("predictions.viewer.output.downloadCsv")}
      </Button>
    </details>
  </div>;
}
