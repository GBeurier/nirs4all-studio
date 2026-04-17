/**
 * Unified prediction chart viewer (modal shell).
 *
 * Layout top→bottom:
 *   header / toolbar (kind switcher + partitions) / secondary toolbar
 *   (gear + exports) / chart area / metrics strip.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  BarChart3,
  Database,
  FileSpreadsheet,
  Grid3x3,
  ImageDown,
  Layers,
  Loader2,
  ScatterChart as ScatterIcon,
  TrendingUp,
  Brain,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { isClassificationTask } from "@/components/runs/modelDetailClassification";
import { ChartConfigPopover } from "./ChartConfigPopover";
import { PredictionColorLegend } from "./PredictionColorLegend";
import { PartitionToggles } from "./PartitionToggles";
import { MetricsStrip } from "./MetricsStrip";
import { usePredictionChartConfig } from "./usePredictionChartConfig";
import { usePartitionsData } from "./fetchPartitionData";
import { buildPredictionColoration } from "./coloration";
import {
  exportChartPng,
  exportRowsCsv,
  resolveExportBackground,
  sanitizeFilename,
} from "./export";
import { PredictionScatterChart } from "./charts/PredictionScatterChart";
import { PredictionResidualsChart } from "./charts/PredictionResidualsChart";
import { PredictionConfusionChart } from "./charts/PredictionConfusionChart";
import { PredictionHistogramChart } from "./charts/PredictionHistogramChart";
import type { ChartKind, PredictionViewerProps, TaskKind } from "./types";

function resolveInitialKind(
  initialKind: ChartKind | undefined,
  taskKind: TaskKind,
): ChartKind {
  const available: ChartKind[] =
    taskKind === "classification"
      ? ["confusion", "distribution"]
      : ["scatter", "residuals", "distribution"];
  if (initialKind && available.includes(initialKind)) return initialKind;
  return taskKind === "classification" ? "confusion" : "scatter";
}

export function PredictionViewer({
  open,
  onOpenChange,
  header,
  partitions,
  workspaceId,
  initialKind,
}: PredictionViewerProps) {
  const configDatasetKey = useMemo(
    () => `${workspaceId ?? "__current__"}::${header.datasetName}`,
    [workspaceId, header.datasetName],
  );
  const [config, setConfig, resetConfig] = usePredictionChartConfig({ datasetKey: configDatasetKey });

  const taskKind: TaskKind = useMemo(
    () => (isClassificationTask(header.taskType) ? "classification" : "regression"),
    [header.taskType],
  );

  const [kind, setKind] = useState<ChartKind>(() => resolveInitialKind(initialKind, taskKind));
  const [visible, setVisible] = useState<Set<string>>(() =>
    new Set(partitions.map((p) => p.partition)),
  );

  // Reset kind / visible when viewer opens or when inputs change.
  useEffect(() => {
    if (!open) return;
    setKind(resolveInitialKind(initialKind, taskKind));
  }, [open, initialKind, taskKind]);

  useEffect(() => {
    setVisible(new Set(partitions.map((p) => p.partition)));
  }, [partitions]);

  const { data: allDatasets, isLoading, error } = usePartitionsData({
    partitions,
    workspaceId,
    enabled: open && partitions.length > 0,
  });

  const visibleDatasets = useMemo(
    () => allDatasets.filter((d) => visible.has(d.partition)),
    [allDatasets, visible],
  );
  const coloration = useMemo(
    () => buildPredictionColoration(allDatasets, config),
    [allDatasets, config],
  );

  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || config.colorMode !== "metadata") return;
    if (coloration.metadataColumns.length === 0) return;
    if (config.metadataKey && coloration.metadataColumns.includes(config.metadataKey)) return;
    setConfig((prev) => ({
      ...prev,
      metadataKey: coloration.metadataColumns[0],
      metadataType: undefined,
    }));
  }, [open, config.colorMode, config.metadataKey, coloration.metadataColumns, setConfig]);

  const kindLabel: Record<ChartKind, string> = {
    scatter: "scatter",
    residuals: "residuals",
    confusion: "confusion",
    distribution: "distribution",
  };

  const baseFilename = `${sanitizeFilename(header.datasetName)}_${sanitizeFilename(
    header.modelName,
  )}_${kindLabel[kind]}`;

  const handleExportPng = () => {
    if (!chartRef.current) return;
    const bg = resolveExportBackground(config.exportTheme);
    exportChartPng(chartRef.current, `${baseFilename}.png`, bg);
  };

  const handleExportCsv = () => {
    if (visibleDatasets.length === 0) return;
    if (kind === "confusion") {
      // Export the pooled confusion matrix cells.
      const pooled: { true_label: number | string; pred_label: number | string; count: number }[] = [];
      const counts = new Map<string, number>();
      for (const d of visibleDatasets) {
        const n = Math.min(d.yTrue.length, d.yPred.length);
        for (let i = 0; i < n; i++) {
          const key = `${d.yTrue[i]}|${d.yPred[i]}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
      for (const [key, count] of counts.entries()) {
        const [t, p] = key.split("|");
        pooled.push({ true_label: t, pred_label: p, count });
      }
      exportRowsCsv(pooled, ["true_label", "pred_label", "count"], `${baseFilename}.csv`);
      return;
    }

    if (kind === "distribution") {
      // Flat long-form rows: one per (partition, series, value).
      const series =
        config.histogramSeries === "both"
          ? (["actual", "predicted"] as const)
          : config.histogramSeries === "actual"
          ? (["actual"] as const)
          : config.histogramSeries === "residuals"
          ? (["residual"] as const)
          : (["predicted"] as const);
      const rows: { partition: string; series: string; value: number; sample_id: number }[] = [];
      for (const d of visibleDatasets) {
        const n = Math.min(d.yTrue.length, d.yPred.length);
        for (let i = 0; i < n; i++) {
          for (const s of series) {
            const value =
              s === "actual" ? d.yTrue[i] : s === "predicted" ? d.yPred[i] : d.yTrue[i] - d.yPred[i];
            if (!Number.isFinite(value)) continue;
            rows.push({ partition: d.label, series: s, value, sample_id: i });
          }
        }
      }
      exportRowsCsv(rows, ["sample_id", "partition", "series", "value"], `${baseFilename}.csv`);
      return;
    }

    const rows: { sample_id: number; partition: string; y_true: number; y_pred: number; residual: number }[] = [];
    for (const d of visibleDatasets) {
      const n = Math.min(d.yTrue.length, d.yPred.length);
      for (let i = 0; i < n; i++) {
        rows.push({
          sample_id: i,
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

  const toggleVisible = (partition: string) => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(partition)) next.delete(partition);
      else next.add(partition);
      return next;
    });
  };

  const headerTitle = useMemo(() => {
    return [header.modelName ?? "Model", header.datasetName].filter(Boolean).join(" · ");
  }, [header.modelName, header.datasetName]);

  const headerDescription = useMemo(() => {
    const details = [
      header.datasetName ? `dataset ${header.datasetName}` : null,
      header.modelName ? `model ${header.modelName}` : null,
      header.taskType ? `${header.taskType} task` : null,
    ].filter(Boolean);

    if (details.length === 0) {
      return "Inspect prediction charts and export the current view.";
    }

    return `Inspect prediction charts for ${details.join(", ")}.`;
  }, [header.datasetName, header.modelName, header.taskType]);

  const availableKinds: ChartKind[] =
    taskKind === "classification"
      ? ["confusion", "distribution"]
      : ["scatter", "residuals", "distribution"];

  const hasActuals = useMemo(
    () => allDatasets.some((d) => d.yTrue.some((v) => Number.isFinite(v))),
    [allDatasets],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-[90vw] h-[85vh] p-0 flex flex-col">
        <DialogHeader className="border-b px-5 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <ScatterIcon className="h-4 w-4 text-primary" />
            <span className="truncate">{headerTitle || "Prediction viewer"}</span>
          </DialogTitle>
          <DialogDescription className="sr-only">{headerDescription}</DialogDescription>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Database className="h-3.5 w-3.5" />
              {header.datasetName}
            </span>
            {header.modelName && (
              <span className="inline-flex items-center gap-1">
                <Brain className="h-3.5 w-3.5 text-primary" />
                <Badge variant="outline" className="h-5 px-1.5">
                  {header.modelName}
                </Badge>
              </span>
            )}
            {header.preprocessings && (
              <span className="inline-flex items-center gap-1">
                <Layers className="h-3.5 w-3.5" />
                {header.preprocessings}
              </span>
            )}
            {header.foldId && <span>Fold: {header.foldId}</span>}
          </div>
        </DialogHeader>

        {/* Primary toolbar: kind switcher + partition chips */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-2">
          <ToggleGroup
            type="single"
            size="sm"
            value={kind}
            onValueChange={(v) => {
              if (v && availableKinds.includes(v as ChartKind)) {
                setKind(v as ChartKind);
              }
            }}
            className="justify-start"
          >
            {availableKinds.includes("scatter") && (
              <ToggleGroupItem value="scatter" className="h-8 gap-1.5 text-xs">
                <TrendingUp className="h-3.5 w-3.5" />
                Scatter
              </ToggleGroupItem>
            )}
            {availableKinds.includes("residuals") && (
              <ToggleGroupItem value="residuals" className="h-8 gap-1.5 text-xs">
                <BarChart3 className="h-3.5 w-3.5" />
                Residuals
              </ToggleGroupItem>
            )}
            {availableKinds.includes("confusion") && (
              <ToggleGroupItem value="confusion" className="h-8 gap-1.5 text-xs">
                <Grid3x3 className="h-3.5 w-3.5" />
                Confusion
              </ToggleGroupItem>
            )}
            {availableKinds.includes("distribution") && (
              <ToggleGroupItem value="distribution" className="h-8 gap-1.5 text-xs">
                <Activity className="h-3.5 w-3.5" />
                Distribution
              </ToggleGroupItem>
            )}
          </ToggleGroup>

          <PartitionToggles
            partitions={partitions}
            visible={visible}
            onToggle={toggleVisible}
            palette={config.palette}
            colors={config.partitionColors}
          />
        </div>

        {/* Secondary toolbar: gear + exports */}
        <div className="flex items-center justify-end gap-2 border-b px-5 py-2">
          <ChartConfigPopover
            kind={kind}
            config={config}
            metadataColumns={coloration.metadataColumns}
            resolvedMetadataType={coloration.metadataType}
            onChange={setConfig}
            onReset={resetConfig}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={handleExportPng}
            disabled={visibleDatasets.length === 0}
          >
            <ImageDown className="h-3.5 w-3.5" />
            PNG
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={handleExportCsv}
            disabled={visibleDatasets.length === 0}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            CSV
          </Button>
        </div>

        {kind !== "confusion" && visibleDatasets.length > 0 && (config.colorMode === "partition" || coloration.metadataKey) && (
          <div className="border-b px-5 py-2">
            <PredictionColorLegend datasets={visibleDatasets} config={config} />
          </div>
        )}

        {/* Chart area */}
        <div className="min-h-0 flex-1 px-5 py-3">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              <span className="text-sm">Loading prediction data…</span>
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center">
              <div className="max-w-sm rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-center">
                <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/15">
                  <AlertCircle className="h-5 w-5 text-destructive" />
                </div>
                <div className="text-sm font-medium text-destructive">Unable to load predictions</div>
                <div className="mt-1 text-xs leading-5 text-destructive/80">{error}</div>
              </div>
            </div>
          ) : visibleDatasets.length === 0 ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <span className="text-sm">Select at least one partition to display.</span>
            </div>
          ) : kind === "scatter" ? (
            <PredictionScatterChart ref={chartRef} datasets={visibleDatasets} config={config} variant="full" />
          ) : kind === "residuals" ? (
            <PredictionResidualsChart ref={chartRef} datasets={visibleDatasets} config={config} variant="full" />
          ) : kind === "confusion" ? (
            <PredictionConfusionChart ref={chartRef} datasets={visibleDatasets} config={config} variant="full" />
          ) : (
            <PredictionHistogramChart
              ref={chartRef}
              datasets={visibleDatasets}
              config={config}
              taskKind={taskKind}
              hasActuals={hasActuals}
              variant="full"
            />
          )}
        </div>

        <MetricsStrip taskKind={taskKind} datasets={visibleDatasets} header={header} />
      </DialogContent>
    </Dialog>
  );
}
