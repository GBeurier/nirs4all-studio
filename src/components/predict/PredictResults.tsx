import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Brain,
  Database,
  Download,
  FileText,
  Maximize2,
  RotateCcw,
  Table as TableIcon,
  Target,
} from "lucide-react";

import { useDatasetsQuery } from "@/hooks/useDatasetQueries";
import { exportDataAsCSV } from "@/lib/chartExport";
import { getPredictionMetricLabel } from "@/lib/predict-metrics";
import {
  formatMetricName,
  formatMetricValue,
  getMetricDefinitions,
} from "@/lib/scores";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  exportChartPng,
  exportRowsCsv,
  resolveExportBackground,
  sanitizeFilename,
} from "@/components/predictions/viewer/export";
import { usePredictionChartConfig } from "@/components/predictions/viewer/usePredictionChartConfig";
import type {
  PartitionDataset,
  TaskKind,
  ViewerHeader,
} from "@/components/predictions/viewer/types";

import type { AvailableModel, PredictResponse } from "@/types/predict";

import { PredictChartPanel, type PanelKind } from "./PredictChartPanel";

export type PredictionInput =
  | { type: "dataset"; datasetId: string; datasetName?: string | null; partition: string }
  | { type: "file"; fileName: string }
  | { type: "array"; rowCount: number };

interface PredictResultsProps {
  result: PredictResponse;
  model?: AvailableModel | null;
  input?: PredictionInput | null;
  onReset: () => void;
}

function computeStats(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = sum / count;
  const variance =
    sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / count;
  const std = Math.sqrt(variance);
  const median =
    count % 2 === 0
      ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2
      : sorted[Math.floor(count / 2)];
  const q1 = sorted[Math.floor(count * 0.25)];
  const q3 = sorted[Math.floor(count * 0.75)];

  return {
    count,
    mean,
    std,
    min: sorted[0],
    q1,
    median,
    q3,
    max: sorted[count - 1],
  };
}

function getMetricLabel(metric: string): string {
  const normalized = metric.toLowerCase();
  if (normalized === "rmse" || normalized === "rmsep") {
    return getPredictionMetricLabel(normalized);
  }
  if (normalized === "r2") return "R²";
  return formatMetricName(normalized);
}

function groupsOf(keys: readonly string[]): Set<string> {
  return new Set(getMetricDefinitions(keys).map((d) => d.group));
}

/**
 * Infer regression vs. classification from, in order of preference:
 *   1. The model's prediction_metric / metric via the shared metric registry
 *   2. The model_class / name string for obvious suffixes
 *   3. The response's metric keys
 *   4. A tight heuristic on the data (BOTH actuals and predictions must be
 *      integer-valued with a small cardinality — otherwise regression).
 */
function detectTaskKind(
  metrics: Record<string, number> | null,
  actualValues: number[] | null,
  predictions: number[],
  model?: AvailableModel | null,
): TaskKind {
  const modelMetric = (model?.prediction_metric || model?.metric || "").toLowerCase();
  if (modelMetric) {
    const groups = groupsOf([modelMetric]);
    if (groups.has("regression")) return "regression";
    if (groups.has("multiclass") || groups.has("binary")) return "classification";
  }

  const combined = `${model?.model_class ?? ""} ${model?.name ?? ""} ${model?.id ?? ""}`.toLowerCase();
  if (/(regress|regressor|\bpls\b|\bpcr\b|\bridge\b|\blasso\b|\belasticnet\b|\bsvr\b|\bgbr\b)/.test(combined)) {
    return "regression";
  }
  if (/(classif|classifier|logisticregression|\bsvc\b|\bmlpclassifier\b|\bknnclassifier\b)/.test(combined)) {
    return "classification";
  }

  if (metrics) {
    const keys = Object.keys(metrics);
    const groups = groupsOf(keys);
    if (groups.has("regression")) return "regression";
    if (groups.has("multiclass") || groups.has("binary")) return "classification";
  }

  const probeActual =
    actualValues && actualValues.length > 0
      ? actualValues.slice(0, 300).filter((v) => Number.isFinite(v))
      : [];
  const probePred = predictions.slice(0, 300).filter((v) => Number.isFinite(v));
  if (probePred.length > 0) {
    const actualsInt = probeActual.length > 0 && probeActual.every((v) => Number.isInteger(v));
    const predsInt = probePred.every((v) => Number.isInteger(v));
    const uniqueCombined = new Set<number>();
    for (const v of probePred) uniqueCombined.add(v);
    for (const v of probeActual) uniqueCombined.add(v);
    // Require BOTH sides integer-valued and small cardinality. Continuous
    // regression predictions (PLS/PCR) won't satisfy predsInt.
    if (actualsInt && predsInt && uniqueCombined.size <= 10 && uniqueCombined.size >= 2) {
      return "classification";
    }
  }
  return "regression";
}

const PARTITION_ORDER: Record<string, number> = {
  train: 0,
  val: 1,
  test: 2,
};

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Split the flat response into one PartitionDataset per partition when the
 * backend returned per-sample partition labels ("all" mode). When it didn't,
 * produce a single dataset labelled from the actual request context.
 */
function buildPartitionDatasets(
  result: PredictResponse,
  hasActuals: boolean,
  fallbackPartition: string,
): PartitionDataset[] {
  const n = result.predictions.length;
  const perSample = result.partitions ?? null;

  if (perSample && perSample.length === n && new Set(perSample.filter(Boolean)).size > 1) {
    const groups = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      const key = (perSample[i] || fallbackPartition || "pred").toLowerCase();
      const list = groups.get(key) ?? [];
      list.push(i);
      groups.set(key, list);
    }
    const keys = Array.from(groups.keys()).sort((a, b) => {
      const ra = PARTITION_ORDER[a] ?? Number.MAX_SAFE_INTEGER;
      const rb = PARTITION_ORDER[b] ?? Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return a.localeCompare(b);
    });

    return keys.map((key) => {
      const indices = groups.get(key)!;
      return {
        predictionId: `predict-inline-${result.model_name}-${key}`,
        partition: key,
        label: capitalize(key),
        yTrue: hasActuals ? indices.map((i) => result.actual_values![i]) : [],
        yPred: indices.map((i) => result.predictions[i]),
        nSamples: indices.length,
      };
    });
  }

  const partitionKey = (fallbackPartition || (hasActuals ? "test" : "pred")).toLowerCase();
  return [
    {
      predictionId: `predict-inline-${result.model_name}-${partitionKey}`,
      partition: partitionKey,
      label: capitalize(partitionKey),
      yTrue: hasActuals ? result.actual_values ?? [] : [],
      yPred: result.predictions,
      nSamples: n,
    },
  ];
}

function inputLabel(input: PredictionInput | null | undefined, fallback: string): string {
  if (!input) return fallback;
  if (input.type === "dataset") {
    return input.datasetName || input.datasetId;
  }
  if (input.type === "file") return input.fileName;
  return `${input.rowCount} pasted row${input.rowCount === 1 ? "" : "s"}`;
}

function inputSubLabel(input: PredictionInput | null | undefined): string | null {
  if (!input) return null;
  if (input.type === "dataset") return `partition: ${input.partition}`;
  if (input.type === "file") return "uploaded file";
  if (input.type === "array") return "pasted spectra";
  return null;
}

function resolveDefaultKind(
  availableKinds: PanelKind[],
  taskKind: TaskKind,
  hasActuals: boolean,
): PanelKind {
  if (!hasActuals) return "distribution";
  if (taskKind === "classification" && availableKinds.includes("confusion")) return "confusion";
  if (taskKind === "regression" && availableKinds.includes("scatter")) return "scatter";
  return availableKinds[0] ?? "distribution";
}

export function PredictResults({ result, model, input, onReset }: PredictResultsProps) {
  const { t } = useTranslation();
  const { data: datasetsData } = useDatasetsQuery();

  // Resolve a dataset name from the datasets cache when only the id was passed.
  const resolvedInput = useMemo<PredictionInput | null>(() => {
    if (!input) return null;
    if (input.type !== "dataset") return input;
    if (input.datasetName) return input;
    const match = datasetsData?.datasets?.find((d) => d.id === input.datasetId);
    return { ...input, datasetName: match?.name ?? input.datasetId };
  }, [input, datasetsData]);

  const hasActuals = result.actual_values != null && result.actual_values.length > 0;
  const hasMetrics = result.metrics != null;

  const taskKind = useMemo(
    () => detectTaskKind(result.metrics, result.actual_values, result.predictions, model),
    [result.metrics, result.actual_values, result.predictions, model],
  );

  const fallbackPartition =
    resolvedInput?.type === "dataset" ? resolvedInput.partition : hasActuals ? "test" : "pred";

  const partitionDatasets = useMemo(
    () => buildPartitionDatasets(result, hasActuals, fallbackPartition),
    [result, hasActuals, fallbackPartition],
  );

  const displayName = inputLabel(resolvedInput, model?.dataset_name ?? "Prediction input");
  const displaySubLabel = inputSubLabel(resolvedInput);

  const header: ViewerHeader = useMemo(
    () => ({
      datasetName: displayName,
      modelName: result.model_name,
      preprocessings:
        result.preprocessing_steps.length > 0
          ? result.preprocessing_steps.join(" · ")
          : null,
      taskType: taskKind === "classification" ? "classification" : "regression",
      nSamples: result.num_samples,
    }),
    [displayName, result.model_name, result.num_samples, result.preprocessing_steps, taskKind],
  );

  const availableKinds = useMemo<PanelKind[]>(() => {
    const kinds: PanelKind[] = [];
    if (hasActuals) {
      if (taskKind === "regression") {
        kinds.push("scatter", "residuals");
      } else {
        kinds.push("confusion");
      }
    }
    kinds.push("distribution");
    return kinds;
  }, [hasActuals, taskKind]);

  const [kind, setKind] = useState<PanelKind>(() =>
    resolveDefaultKind(availableKinds, taskKind, hasActuals),
  );
  const [expanded, setExpanded] = useState(false);

  // Reset the selected view whenever the underlying result makes the current
  // kind unavailable (e.g. switching from a classification result to a
  // regression one, or back to a no-actuals run).
  useEffect(() => {
    if (!availableKinds.includes(kind)) {
      setKind(resolveDefaultKind(availableKinds, taskKind, hasActuals));
    }
  }, [availableKinds, hasActuals, kind, taskKind]);

  const configDatasetKey = useMemo(
    () => `predict::${result.model_name}`,
    [result.model_name],
  );
  const [config, setConfig, resetConfig] = usePredictionChartConfig({
    datasetKey: configDatasetKey,
  });

  const inlineChartRef = useRef<HTMLDivElement>(null);
  const fullscreenChartRef = useRef<HTMLDivElement>(null);

  const tableData = useMemo(
    () =>
      result.predictions.map((prediction, index) => ({
        index: result.sample_ids?.[index] ?? index + 1,
        partition:
          result.partitions && result.partitions.length === result.predictions.length
            ? result.partitions[index]
            : null,
        predicted: prediction,
        actual: hasActuals ? result.actual_values![index] : undefined,
        residual: hasActuals ? result.actual_values![index] - prediction : undefined,
      })),
    [hasActuals, result],
  );

  const showPartitionColumn = tableData.some((row) => row.partition);

  const metricEntries = useMemo(() => {
    if (!result.metrics) return [];

    const priority = [
      "rmsep",
      "rmse",
      "r2",
      "mae",
      "accuracy",
      "balanced_accuracy",
      "f1",
      "f1_macro",
      "precision",
      "recall",
      "rpd",
      "sep",
      "bias",
    ];
    const seen = new Set<string>();
    const ordered: { key: string; value: number }[] = [];

    for (const key of priority) {
      const alias = key === "rmsep" ? "rmse" : key;
      const value = result.metrics[alias];
      if (value == null || seen.has(alias)) continue;
      seen.add(alias);
      ordered.push({ key: alias, value });
    }

    for (const [key, value] of Object.entries(result.metrics)) {
      if (value == null || seen.has(key)) continue;
      seen.add(key);
      ordered.push({ key, value });
    }

    return ordered;
  }, [result.metrics]);

  const summaryMetric = metricEntries[0] ?? null;
  const predictionStats = useMemo(() => computeStats(result.predictions), [result.predictions]);

  const handleExportTableCsv = () => {
    const rows = tableData.map((row) => {
      const record: Record<string, number | string> = {
        sample: String(row.index),
        predicted: row.predicted,
      };
      if (row.partition) record.partition = row.partition;
      if (row.actual !== undefined) record.actual = row.actual;
      if (row.residual !== undefined) record.residual = row.residual;
      return record;
    });
    exportDataAsCSV(rows, `predictions_${result.model_name}`);
  };

  const baseFilename = useMemo(
    () =>
      `${sanitizeFilename(displayName)}_${sanitizeFilename(result.model_name)}_${kind}`,
    [displayName, result.model_name, kind],
  );

  const handleExportPng = (container: HTMLElement | null) => {
    const bg = resolveExportBackground(config.exportTheme);
    exportChartPng(container, `${baseFilename}.png`, bg);
  };

  const handleExportChartCsv = () => {
    if (kind === "distribution") {
      if (taskKind === "classification") {
        const rows: { sample_id: string; partition: string; y_pred: number; y_true: number | "" }[] = [];
        for (const d of partitionDatasets) {
          for (let i = 0; i < d.yPred.length; i++) {
            rows.push({
              sample_id: String(i + 1),
              partition: d.label,
              y_pred: d.yPred[i],
              y_true: hasActuals && d.yTrue[i] !== undefined ? d.yTrue[i] : "",
            });
          }
        }
        exportRowsCsv(
          rows,
          ["sample_id", "partition", "y_true", "y_pred"],
          `${baseFilename}.csv`,
        );
        return;
      }
      const rows = result.predictions.map((value, index) => ({
        sample_id: String(result.sample_ids?.[index] ?? index + 1),
        y_pred: value,
      }));
      exportRowsCsv(rows, ["sample_id", "y_pred"], `${baseFilename}.csv`);
      return;
    }

    if (kind === "confusion") {
      const counts = new Map<string, number>();
      for (const d of partitionDatasets) {
        const n = Math.min(d.yTrue.length, d.yPred.length);
        for (let i = 0; i < n; i++) {
          const key = `${d.yTrue[i]}|${d.yPred[i]}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
      const rows: { true_label: string; pred_label: string; count: number }[] = [];
      for (const [key, count] of counts.entries()) {
        const [trueLabel, predLabel] = key.split("|");
        rows.push({ true_label: trueLabel, pred_label: predLabel, count });
      }
      exportRowsCsv(rows, ["true_label", "pred_label", "count"], `${baseFilename}.csv`);
      return;
    }

    const rows: {
      sample_id: string;
      partition: string;
      y_true: number;
      y_pred: number;
      residual: number;
    }[] = [];
    for (const d of partitionDatasets) {
      const n = Math.min(d.yTrue.length, d.yPred.length);
      for (let i = 0; i < n; i++) {
        rows.push({
          sample_id: String(i + 1),
          partition: d.label,
          y_true: d.yTrue[i],
          y_pred: d.yPred[i],
          residual: d.yTrue[i] - d.yPred[i],
        });
      }
    }
    exportRowsCsv(
      rows,
      ["sample_id", "partition", "y_true", "y_pred", "residual"],
      `${baseFilename}.csv`,
    );
  };

  const taskBadgeLabel = taskKind === "classification" ? "Classification" : "Regression";
  const referenceLabel = hasActuals ? "Reference values available" : "No reference values";

  return (
    <>
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-lg">{t("predict.results.title")}</CardTitle>
                <Badge
                  variant="outline"
                  className={cn(
                    "h-5 px-2 text-[10px] uppercase tracking-wider",
                    taskKind === "classification"
                      ? "border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-300"
                      : "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
                  )}
                >
                  {taskBadgeLabel}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    "h-5 px-2 text-[10px] uppercase tracking-wider",
                    hasActuals
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300",
                  )}
                >
                  {referenceLabel}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {t("predict.results.summary", {
                  count: result.num_samples,
                  model: result.model_name,
                })}
              </p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  {resolvedInput?.type === "file" ? (
                    <FileText className="h-3.5 w-3.5" />
                  ) : (
                    <Database className="h-3.5 w-3.5" />
                  )}
                  {displayName}
                  {displaySubLabel && (
                    <span className="text-muted-foreground/70">({displaySubLabel})</span>
                  )}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Brain className="h-3.5 w-3.5 text-primary" />
                  {result.model_name}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleExportTableCsv}>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                {t("predict.results.export.csv")}
              </Button>
              <Button variant="outline" size="sm" onClick={onReset}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                {t("predict.results.newPrediction")}
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border bg-muted/30 p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Samples
              </p>
              <p className="mt-2 text-2xl font-semibold">{result.num_samples}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {partitionDatasets.length > 1
                  ? `${partitionDatasets.length} partitions`
                  : "Predictions in this run"}
              </p>
            </div>

            <div className="rounded-xl border bg-muted/30 p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Reference
              </p>
              <p className="mt-2 text-2xl font-semibold">
                {hasActuals ? "Available" : "Missing"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {hasActuals
                  ? "Quality metrics computed against targets"
                  : "Upload data with targets for scatter / residuals / confusion"}
              </p>
            </div>

            <div className="rounded-xl border bg-muted/30 p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {summaryMetric ? getMetricLabel(summaryMetric.key) : "Prediction metric"}
              </p>
              <p className="mt-2 text-2xl font-semibold">
                {summaryMetric
                  ? formatMetricValue(summaryMetric.value, summaryMetric.key)
                  : "—"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {summaryMetric
                  ? "Primary metric for this prediction"
                  : "No comparable score available"}
              </p>
            </div>
          </div>

          {result.preprocessing_steps.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Preprocessing
              </span>
              {result.preprocessing_steps.map((step) => (
                <Badge key={step} variant="outline" className="text-xs">
                  {step}
                </Badge>
              ))}
            </div>
          )}
        </CardHeader>

        <CardContent className="space-y-4">
          {hasMetrics && metricEntries.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {metricEntries.map(({ key, value }) => (
                <div key={key} className="rounded-xl border bg-card p-4">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {getMetricLabel(key)}
                  </p>
                  <p className="mt-2 text-xl font-semibold">
                    {formatMetricValue(value, key)}
                  </p>
                </div>
              ))}
            </div>
          )}

          {predictionStats && (
            <div className="rounded-xl border bg-muted/20 p-4">
              <div className="flex items-center gap-2">
                <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Predicted distribution
                </p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-center sm:grid-cols-4 xl:grid-cols-8">
                {(
                  [
                    ["N", predictionStats.count],
                    ["Mean", predictionStats.mean],
                    ["Std", predictionStats.std],
                    ["Min", predictionStats.min],
                    ["Q1", predictionStats.q1],
                    ["Median", predictionStats.median],
                    ["Q3", predictionStats.q3],
                    ["Max", predictionStats.max],
                  ] as [string, number][]
                ).map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-background p-3">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {label}
                    </p>
                    <p className="mt-1 text-sm font-medium">
                      {label === "N" ? value : formatMetricValue(value)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Tabs defaultValue="chart">
            <TabsList>
              <TabsTrigger value="chart" className="gap-1.5">
                <Target className="h-3.5 w-3.5" />
                Chart view
              </TabsTrigger>
              <TabsTrigger value="table" className="gap-1.5">
                <TableIcon className="h-3.5 w-3.5" />
                {t("predict.results.tabs.table")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="chart" className="mt-3">
              <PredictChartPanel
                ref={inlineChartRef}
                datasets={partitionDatasets}
                header={header}
                taskKind={taskKind}
                hasActuals={hasActuals}
                availableKinds={availableKinds}
                kind={kind}
                onKindChange={setKind}
                config={config}
                onConfigChange={setConfig}
                onConfigReset={resetConfig}
                onExportPng={() => handleExportPng(inlineChartRef.current)}
                onExportCsv={handleExportChartCsv}
                onExpand={() => setExpanded(true)}
              />
            </TabsContent>

            <TabsContent value="table" className="mt-3">
              <div className="max-h-[460px] overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">
                        {t("predict.results.table.sample")}
                      </TableHead>
                      {showPartitionColumn && (
                        <TableHead className="w-24">Partition</TableHead>
                      )}
                      <TableHead className="text-right">
                        {t("predict.results.table.predicted")}
                      </TableHead>
                      {hasActuals && (
                        <>
                          <TableHead className="text-right">
                            {t("predict.results.table.actual")}
                          </TableHead>
                          <TableHead className="text-right">
                            {t("predict.results.table.residual")}
                          </TableHead>
                        </>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tableData.map((row, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-mono text-xs">{String(row.index)}</TableCell>
                        {showPartitionColumn && (
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {row.partition ? capitalize(row.partition) : "—"}
                          </TableCell>
                        )}
                        <TableCell className="text-right font-mono text-sm">
                          {formatMetricValue(row.predicted)}
                        </TableCell>
                        {hasActuals && (
                          <>
                            <TableCell className="text-right font-mono text-sm">
                              {row.actual !== undefined ? formatMetricValue(row.actual) : "—"}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {row.residual !== undefined ? formatMetricValue(row.residual) : "—"}
                            </TableCell>
                          </>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="flex h-[88vh] w-[92vw] max-w-[1200px] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b px-5 py-3">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Maximize2 className="h-4 w-4 text-primary" />
              <span className="truncate">
                {result.model_name}
                {displayName ? ` · ${displayName}` : ""}
              </span>
            </DialogTitle>
            <DialogDescription className="sr-only">
              Fullscreen prediction chart — customize, export PNG or CSV.
            </DialogDescription>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge
                variant="outline"
                className={cn(
                  "h-5 px-2 text-[10px] uppercase tracking-wider",
                  taskKind === "classification"
                    ? "border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-300"
                    : "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
                )}
              >
                {taskBadgeLabel}
              </Badge>
              <span>{result.num_samples} samples</span>
              {displaySubLabel && <span>· {displaySubLabel}</span>}
              {header.preprocessings && <span>· {header.preprocessings}</span>}
            </div>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col p-4">
            <PredictChartPanel
              ref={fullscreenChartRef}
              datasets={partitionDatasets}
              header={header}
              taskKind={taskKind}
              hasActuals={hasActuals}
              availableKinds={availableKinds}
              kind={kind}
              onKindChange={setKind}
              config={config}
              onConfigChange={setConfig}
              onConfigReset={resetConfig}
              onExportPng={() => handleExportPng(fullscreenChartRef.current)}
              onExportCsv={handleExportChartCsv}
              isFullscreen
              className="flex-1"
              chartClassName="h-full"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
