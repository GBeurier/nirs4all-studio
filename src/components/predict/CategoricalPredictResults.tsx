import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { buildConfusionMatrixFromVectors } from "@/components/runs/modelDetailClassification";
import { exportRowsCsv, sanitizeFilename } from "@/components/predictions/viewer/export";
import type { PredictResponse, PredictionValue } from "@/types/predict";

export function CategoricalPredictResults({ result, onReset }: {
  result: PredictResponse<PredictionValue>;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const rows = result.predictions.map((prediction, index) => ({
    sample: result.sample_labels?.[index] ?? result.sample_ids?.[index] ?? index + 1,
    partition: result.partitions?.[index] ?? "",
    actual: result.actual_values?.[index] ?? "",
    prediction,
  }));
  const distribution = new Map<string, number>();
  for (const prediction of result.predictions) {
    const label = String(prediction);
    distribution.set(label, (distribution.get(label) ?? 0) + 1);
  }
  const confusion = result.actual_values ? buildConfusionMatrixFromVectors({
    yTrue: result.actual_values, yPred: result.predictions, normalize: "none", partitionLabel: t("predict.view.inputFallback"),
  }) : null;
  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-4">
      <div><h2 className="text-lg font-semibold">{t("predict.categorical.title")}</h2><p className="text-sm text-muted-foreground">{result.model_name} · {t("predict.view.samplesCount", { count: result.num_samples })}</p></div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => exportRowsCsv(rows, ["sample", "partition", "actual", "prediction"], `${sanitizeFilename(result.model_name)}_predictions.csv`)}>{t("predict.results.export.csv")}</Button>
        <Button variant="outline" onClick={onReset}>{t("predict.results.newPrediction")}</Button>
      </div>
    </div>
    {result.metrics && <div className="flex flex-wrap gap-3">{Object.entries(result.metrics).filter(([, value]) => Number.isFinite(value)).map(([name, value]) =>
      <Card className="p-3" key={name}><div className="text-xs text-muted-foreground">{name.replace(/_/g, " ")}</div><div className="font-semibold">{value.toFixed(4)}</div></Card>,
    )}</div>}
    <Card className="space-y-2 p-4"><h3 className="font-semibold">{t("predict.categorical.distribution")}</h3>
      {[...distribution].sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => <div key={label} className="grid grid-cols-[minmax(100px,1fr)_3fr_50px] items-center gap-3">
        <span>{label}</span><div className="h-3 rounded bg-muted"><div className="h-3 rounded bg-primary" style={{ width: `${100 * count / result.num_samples}%` }} /></div><span>{count}</span>
      </div>)}
    </Card>
    {confusion && <Card className="overflow-x-auto p-4"><h3 className="mb-2 font-semibold">{t("predict.categorical.confusionMatrix")}</h3><p className="mb-3 text-xs text-muted-foreground">{t("predict.categorical.confusionHint")}</p>
      {confusion.reason ? <p>{confusion.reason}</p> : <table className="w-full text-sm"><thead><tr><th>{t("predict.categorical.actualPredicted")}</th>{confusion.labels.map(label => <th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>
        {confusion.labels.map(actual => <tr key={actual}><th className="p-2 text-left">{actual}</th>{confusion.labels.map(predicted => {
          const count = confusion.cells.find(cell => cell.true_label === actual && cell.pred_label === predicted)?.count ?? 0;
          return <td key={predicted} className="p-2 text-center" style={{ backgroundColor: `hsl(var(--primary) / ${0.06 + 0.6 * count / confusion.total_samples})` }}>{count}</td>;
        })}</tr>)}
      </tbody></table>}
    </Card>}
    <Card className="max-h-[480px] overflow-auto p-4"><h3 className="mb-3 font-semibold">{t("predict.categorical.predictions")}</h3><table className="w-full text-sm"><thead><tr><th className="text-left">{t("predict.results.table.sample")}</th><th>{t("predict.data.dataset.partition")}</th>{result.actual_values && <th>{t("predict.categorical.actualClass")}</th>}<th>{t("predict.categorical.predictedClass")}</th></tr></thead><tbody>
      {rows.map((row, index) => <tr className="border-t" key={index}><td className="p-2">{row.sample}</td><td className="p-2 text-center">{row.partition}</td>{result.actual_values && <td className="p-2 text-center">{row.actual}</td>}<td className="p-2 text-center">{row.prediction}</td></tr>)}
    </tbody></table></Card>
  </div>;
}
