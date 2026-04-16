/**
 * ChainDetailPanel — single-view body rendered inside ChainDetailSheet.
 *
 * Replaces the former three-tab layout (Summary / Folds / Arrays) with a
 * scientifically-ordered scroll: identity header → hero metrics → evidence
 * charts → fold-level table → collapsed identity & arrays details.
 *
 * Owns the fetch-on-open and selection state. Charts render with the
 * shared viewer components in `variant="panel"` (axes + tooltips visible,
 * no config chrome). Each tile's "Customize" link defers to the caller's
 * onOpenViewer to reveal the full PredictionViewer modal.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Box,
  Brain,
  ChevronDown,
  Database,
  Grid3x3,
  Layers,
  Loader2,
  Target,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  PARTITION_COLORS,
  normalizePartition,
  partitionBadgeClass,
  type PartitionKey,
} from "@/lib/partitionColors";
import { isClassificationTask } from "@/components/runs/modelDetailClassification";
import {
  getChainDetail,
  getChainPartitionDetail,
  getPredictionArrays,
} from "@/api/client";
import type {
  ChainSummary,
  ChainDetailResponse,
  PartitionPrediction,
  PredictionArraysResponse,
} from "@/types/aggregated-predictions";

/** Lightweight metadata used to render the header before the ChainSummary
 *  fetch resolves (avoids a blank header during the opening animation). */
export interface ChainDetailMetaHint {
  modelName?: string | null;
  modelClass?: string | null;
  datasetName?: string | null;
  metric?: string | null;
  taskType?: string | null;
  preprocessings?: string | null;
  pipelineStatus?: string | null;
}
import {
  PredictionScatterChart,
} from "@/components/predictions/viewer/charts/PredictionScatterChart";
import {
  PredictionResidualsChart,
} from "@/components/predictions/viewer/charts/PredictionResidualsChart";
import {
  PredictionConfusionChart,
} from "@/components/predictions/viewer/charts/PredictionConfusionChart";
import { usePartitionsData } from "@/components/predictions/viewer/fetchPartitionData";
import { usePredictionChartConfig } from "@/components/predictions/viewer/usePredictionChartConfig";
import type {
  ChartConfig,
  ChartKind,
  ViewerHeader,
  ViewerPartitionTarget,
} from "@/components/predictions/viewer/types";
import { HeroMetrics } from "./HeroMetrics";
import { ChartTile } from "./ChartTile";
import { FoldsTable } from "./FoldsTable";

interface ChainDetailPanelProps {
  chainId: string;
  metric?: string | null;
  metaHint?: ChainDetailMetaHint;
  onOpenViewer?: (
    partitions: ViewerPartitionTarget[],
    header: ViewerHeader,
    kind: ChartKind,
  ) => void;
}

/** Pick the prediction_id that represents the "best" fold by val score. */
function pickBestFoldSelection(rows: PartitionPrediction[]): string | null {
  if (rows.length === 0) return null;
  const valRows = rows.filter((r) => r.partition === "val");
  const pool = valRows.length > 0 ? valRows : rows;
  let best = pool[0];
  for (const r of pool) {
    const a = r.val_score ?? Number.NEGATIVE_INFINITY;
    const b = best.val_score ?? Number.NEGATIVE_INFINITY;
    if (a > b) best = r;
  }
  return best.prediction_id;
}

function PartitionLegend({
  partitions,
}: {
  partitions: { partition: string; label?: string }[];
}) {
  if (partitions.length === 0) return null;
  const seen = new Set<string>();
  const dedup = partitions.filter((p) => {
    const key = p.partition.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {dedup.map((p) => {
        const key = normalizePartition(p.partition) as PartitionKey | null;
        const color = key ? PARTITION_COLORS[key] : "hsl(var(--muted-foreground))";
        return (
          <span
            key={p.partition}
            className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
          >
            <span
              aria-hidden
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: color }}
            />
            {p.label ?? p.partition}
          </span>
        );
      })}
    </div>
  );
}

function DetailsSection({
  title,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      className="group rounded-xl border border-border/70 bg-card/40 open:bg-card/70"
      open={defaultOpen}
    >
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center justify-between gap-2",
          "rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/40",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        )}
      >
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-muted text-muted-foreground">
            {icon}
          </span>
          <span className="text-sm font-semibold tracking-tight">{title}</span>
        </div>
        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border/60 px-3 py-3 text-sm">{children}</div>
    </details>
  );
}

function KeyValueRow({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0 text-sm">
      <div className="text-muted-foreground">{k}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function ChainDetailPanel({ chainId, metric, metaHint, onOpenViewer }: ChainDetailPanelProps) {
  const [detail, setDetail] = useState<ChainDetailResponse | null>(null);
  const [partitionRows, setPartitionRows] = useState<PartitionPrediction[]>([]);
  const [partitionFilter, setPartitionFilter] = useState<string>("all");
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [selectedPredictionId, setSelectedPredictionId] = useState<string | null>(null);
  const [arrayData, setArrayData] = useState<PredictionArraysResponse | null>(null);
  const [loadingArrays, setLoadingArrays] = useState(false);

  /** Effective chain-summary facts: prefer fetched summary, fall back to the
   *  caller-supplied hints so the header renders immediately on open. */
  const prediction = useMemo<ChainSummary>(() => {
    const s = detail?.summary;
    if (s) return s;
    const stub: ChainSummary = {
      run_id: "",
      pipeline_id: "",
      chain_id: chainId,
      model_name: metaHint?.modelName ?? null,
      model_class: metaHint?.modelClass ?? "",
      preprocessings: metaHint?.preprocessings ?? null,
      branch_path: null,
      source_index: null,
      model_step_idx: 0,
      metric: metaHint?.metric ?? metric ?? null,
      task_type: metaHint?.taskType ?? null,
      dataset_name: metaHint?.datasetName ?? null,
      best_params: null,
      cv_val_score: null,
      cv_test_score: null,
      cv_train_score: null,
      cv_fold_count: 0,
      cv_scores: null,
      final_test_score: null,
      final_train_score: null,
      final_scores: null,
      pipeline_status: metaHint?.pipelineStatus ?? null,
      fold_artifacts: null,
    };
    return stub;
  }, [detail, chainId, metric, metaHint]);

  const [sharedConfig] = usePredictionChartConfig();
  const panelConfig = useMemo<ChartConfig>(
    () => ({
      ...sharedConfig,
      regressionLine: false,
      sigmaBand: false,
      confusionShowTotals: true,
    }),
    [sharedConfig],
  );

  const taskKind: "regression" | "classification" = useMemo(
    () => (isClassificationTask(prediction.task_type) ? "classification" : "regression"),
    [prediction.task_type],
  );

  // Load chain detail + per-fold partitions once per chain.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingSummary(true);
      try {
        const [chainDetail, partitions] = await Promise.all([
          getChainDetail(chainId, { metric: metric ?? undefined }),
          getChainPartitionDetail(chainId),
        ]);
        if (cancelled) return;
        setDetail(chainDetail);
        setPartitionRows(partitions.predictions);
        setSelectedPredictionId((prev) => prev ?? pickBestFoldSelection(partitions.predictions));
      } catch (err) {
        if (!cancelled) console.error("Failed to load chain detail:", err);
      } finally {
        if (!cancelled) setLoadingSummary(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [chainId, metric]);

  // Load y_true/y_pred arrays for the selected fold (used by the arrays block).
  useEffect(() => {
    if (!selectedPredictionId) {
      setArrayData(null);
      return;
    }
    let cancelled = false;
    async function run() {
      if (!selectedPredictionId) return;
      setLoadingArrays(true);
      try {
        const data = await getPredictionArrays(selectedPredictionId);
        if (!cancelled) setArrayData(data);
      } catch {
        if (!cancelled) setArrayData(null);
      } finally {
        if (!cancelled) setLoadingArrays(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [selectedPredictionId]);

  // All partitions for the selected fold (for chart rendering + viewer).
  const selectedPrediction = useMemo(
    () => partitionRows.find((r) => r.prediction_id === selectedPredictionId) ?? null,
    [partitionRows, selectedPredictionId],
  );

  const selectedFoldPartitions = useMemo<PartitionPrediction[]>(() => {
    if (!selectedPrediction) return [];
    return partitionRows.filter((r) => r.fold_id === selectedPrediction.fold_id);
  }, [partitionRows, selectedPrediction]);

  const chartTargets = useMemo<ViewerPartitionTarget[]>(
    () =>
      selectedFoldPartitions.map((p) => ({
        predictionId: p.prediction_id,
        partition: (p.partition ?? "").toLowerCase(),
        label: p.partition ?? "",
        source: "aggregated" as const,
      })),
    [selectedFoldPartitions],
  );

  const chartHeader = useMemo<ViewerHeader | null>(() => {
    if (!selectedPrediction) return null;
    return {
      datasetName: selectedPrediction.dataset_name ?? prediction.dataset_name ?? "",
      modelName: selectedPrediction.model_name ?? prediction.model_name ?? null,
      preprocessings: selectedPrediction.preprocessings ?? prediction.preprocessings ?? null,
      foldId: selectedPrediction.fold_id ?? null,
      taskType: selectedPrediction.task_type ?? prediction.task_type ?? null,
      valScore: selectedPrediction.val_score ?? null,
      testScore: selectedPrediction.test_score ?? null,
      trainScore: selectedPrediction.train_score ?? null,
      nSamples: selectedPrediction.n_samples ?? null,
      nFeatures: selectedPrediction.n_features ?? null,
    };
  }, [selectedPrediction, prediction]);

  // Fetch data the chart components consume.
  const { data: chartDatasets, isLoading: chartsLoading, error: chartsError } = usePartitionsData({
    partitions: chartTargets,
    enabled: chartTargets.length > 0,
  });

  const handleCustomize = (kind: ChartKind) => {
    if (!chartHeader || chartTargets.length === 0) return;
    onOpenViewer?.(chartTargets, chartHeader, kind);
  };

  const handleOpenFoldInViewer = (predictionId: string) => {
    const row = partitionRows.find((r) => r.prediction_id === predictionId);
    if (!row) return;
    const siblings = partitionRows.filter((r) => r.fold_id === row.fold_id);
    const targets = siblings.map((p) => ({
      predictionId: p.prediction_id,
      partition: (p.partition ?? "").toLowerCase(),
      label: p.partition ?? "",
      source: "aggregated" as const,
    }));
    const header: ViewerHeader = {
      datasetName: row.dataset_name ?? prediction.dataset_name ?? "",
      modelName: row.model_name ?? prediction.model_name ?? null,
      preprocessings: row.preprocessings ?? prediction.preprocessings ?? null,
      foldId: row.fold_id ?? null,
      taskType: row.task_type ?? prediction.task_type ?? null,
      valScore: row.val_score ?? null,
      testScore: row.test_score ?? null,
      trainScore: row.train_score ?? null,
      nSamples: row.n_samples ?? null,
      nFeatures: row.n_features ?? null,
    };
    const defaultKind: ChartKind = taskKind === "classification" ? "confusion" : "scatter";
    onOpenViewer?.(targets, header, defaultKind);
  };

  const foldIdLabel = selectedPrediction?.fold_id ?? "—";
  const preprocessLabel = prediction.preprocessings || "None";

  const chartsPlaceholder = (message: string) => (
    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
      {message}
    </div>
  );

  function ChartBody({ kind }: { kind: ChartKind }) {
    if (chartsLoading) {
      return (
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          <span className="text-xs">Loading…</span>
        </div>
      );
    }
    if (chartsError) return chartsPlaceholder(chartsError);
    if (chartDatasets.length === 0) return chartsPlaceholder("Select a fold to display charts.");
    if (kind === "scatter") {
      return <PredictionScatterChart datasets={chartDatasets} config={panelConfig} variant="panel" />;
    }
    if (kind === "residuals") {
      return <PredictionResidualsChart datasets={chartDatasets} config={panelConfig} variant="panel" />;
    }
    return <PredictionConfusionChart datasets={chartDatasets} config={panelConfig} variant="panel" />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ===== Sticky header ===== */}
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/95 px-5 py-4 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Box className="h-5 w-5 text-primary" aria-hidden />
              <h2 className="truncate font-mono text-base font-semibold tracking-tight text-foreground">
                {prediction.model_name ?? prediction.model_class}
              </h2>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Database className="h-3 w-3" />
                {prediction.dataset_name}
              </span>
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-medium">
                {prediction.metric}
              </Badge>
              {prediction.task_type && (
                <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-medium capitalize">
                  {prediction.task_type}
                </Badge>
              )}
              <span className="inline-flex items-center gap-1">
                <Layers className="h-3 w-3" />
                <span className="truncate max-w-[260px]" title={preprocessLabel}>
                  {preprocessLabel}
                </span>
              </span>
              <Badge
                variant={prediction.pipeline_status === "completed" ? "default" : "secondary"}
                className="h-5 px-1.5 text-[10px] font-medium"
              >
                {prediction.pipeline_status || "unknown"}
              </Badge>
            </div>
          </div>
        </div>
      </header>

      {/* ===== Scrollable body ===== */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-5 px-5 py-5">
          {/* Hero metrics */}
          <HeroMetrics
            cvVal={prediction.cv_val_score}
            cvTest={prediction.cv_test_score}
            cvTrain={prediction.cv_train_score}
            foldCount={prediction.cv_fold_count}
            finalTest={prediction.final_test_score}
            metric={prediction.metric}
          />

          {/* Evidence — chart tiles */}
          <section className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold tracking-tight">Evidence</div>
                <div className="text-[11px] text-muted-foreground">
                  Fold{" "}
                  <span className="font-mono text-foreground">{foldIdLabel}</span>
                  {selectedPrediction && (
                    <>
                      {" "}· {selectedFoldPartitions.length} partition
                      {selectedFoldPartitions.length === 1 ? "" : "s"}
                    </>
                  )}
                </div>
              </div>
              <PartitionLegend partitions={chartTargets} />
            </div>

            {taskKind === "classification" ? (
              <ChartTile
                title="Confusion matrix"
                icon={<Grid3x3 className="h-3.5 w-3.5" />}
                subtitle="Pooled across visible partitions"
                onCustomize={() => handleCustomize("confusion")}
                height="h-[340px]"
              >
                <ChartBody kind="confusion" />
              </ChartTile>
            ) : (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <ChartTile
                  title="Predicted vs Actual"
                  icon={<TrendingUp className="h-3.5 w-3.5" />}
                  subtitle="Points above identity → over-prediction"
                  onCustomize={() => handleCustomize("scatter")}
                >
                  <ChartBody kind="scatter" />
                </ChartTile>
                <ChartTile
                  title="Residuals"
                  icon={<BarChart3 className="h-3.5 w-3.5" />}
                  subtitle="y_true − y_pred across predicted range"
                  onCustomize={() => handleCustomize("residuals")}
                >
                  <ChartBody kind="residuals" />
                </ChartTile>
              </div>
            )}
          </section>

          {/* Folds table */}
          <FoldsTable
            rows={partitionRows}
            loading={loadingSummary}
            partitionFilter={partitionFilter}
            onPartitionFilterChange={setPartitionFilter}
            selectedPredictionId={selectedPredictionId}
            onSelect={setSelectedPredictionId}
            onOpenViewerForFold={handleOpenFoldInViewer}
          />

          {/* Identity + pipeline (collapsed) */}
          <DetailsSection title="Identity & pipeline" icon={<Brain className="h-3.5 w-3.5" />}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <KeyValueRow k="Model">
                  <span className="font-medium">{prediction.model_name ?? "—"}</span>
                </KeyValueRow>
                <KeyValueRow k="Class">{prediction.model_class}</KeyValueRow>
                <KeyValueRow k="Preprocessing">{preprocessLabel}</KeyValueRow>
                <KeyValueRow k="Dataset">
                  <span className="inline-flex items-center gap-1">
                    <Database className="h-3 w-3" /> {prediction.dataset_name}
                  </span>
                </KeyValueRow>
                <KeyValueRow k="Metric">
                  <Badge variant="secondary" className="h-5 text-[10px]">
                    {prediction.metric}
                  </Badge>
                </KeyValueRow>
                {prediction.task_type && (
                  <KeyValueRow k="Task">
                    <span className="capitalize">{prediction.task_type}</span>
                  </KeyValueRow>
                )}
              </div>
              <div className="space-y-1.5">
                {detail?.pipeline ? (
                  <>
                    <KeyValueRow k="Pipeline">{detail.pipeline.name || "—"}</KeyValueRow>
                    <KeyValueRow k="Status">
                      <Badge
                        variant={detail.pipeline.status === "completed" ? "default" : "secondary"}
                        className="h-5 text-[10px]"
                      >
                        {detail.pipeline.status || "unknown"}
                      </Badge>
                    </KeyValueRow>
                  </>
                ) : (
                  <div className="text-xs text-muted-foreground">No pipeline metadata.</div>
                )}
                {prediction.final_test_score != null && (
                  <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2">
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                      <Target className="h-3 w-3" /> Final (refit) scores
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-x-3 text-xs">
                      <div className="text-muted-foreground">Test</div>
                      <div className="font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                        {prediction.final_test_score.toFixed(4)}
                      </div>
                      <div className="text-muted-foreground">Train</div>
                      <div className="font-mono tabular-nums">
                        {prediction.final_train_score != null
                          ? prediction.final_train_score.toFixed(4)
                          : "—"}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {prediction.cv_scores && Object.keys(prediction.cv_scores).length > 0 && (
              <div className="mt-4 rounded-md border border-border/60 bg-muted/30 p-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Multi-metric CV breakdown
                </div>
                <div className="grid grid-cols-[auto_1fr_auto] gap-x-4 gap-y-1 text-xs">
                  {Object.entries(prediction.cv_scores).map(([partition, metrics]) => (
                    <Fragment key={partition}>
                      <div className="col-span-3 mt-1 first:mt-0">
                        <Badge
                          variant="outline"
                          className={cn("h-5 text-[10px]", partitionBadgeClass(partition))}
                        >
                          {partition}
                        </Badge>
                      </div>
                      {Object.entries(metrics).map(([m, v]) => (
                        <Fragment key={m}>
                          <div />
                          <div className="text-muted-foreground">{m}</div>
                          <div className="text-right font-mono tabular-nums">
                            {v != null ? Number(v).toFixed(4) : "—"}
                          </div>
                        </Fragment>
                      ))}
                    </Fragment>
                  ))}
                </div>
              </div>
            )}
          </DetailsSection>

          {/* Raw arrays (collapsed) */}
          <DetailsSection
            title="Raw arrays"
            icon={<Layers className="h-3.5 w-3.5" />}
          >
            {!selectedPredictionId ? (
              <div className="py-2 text-xs text-muted-foreground">
                Select a fold from the table above to inspect raw prediction vectors.
              </div>
            ) : loadingArrays ? (
              <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading arrays…
              </div>
            ) : !arrayData ? (
              <div className="py-2 text-xs text-muted-foreground">
                No array data available for this prediction.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <KeyValueRow k="Prediction ID">
                  <span className="block truncate font-mono text-xs" title={arrayData.prediction_id}>
                    {arrayData.prediction_id}
                  </span>
                </KeyValueRow>
                <KeyValueRow k="Samples">
                  <span className="font-mono tabular-nums">{arrayData.n_samples}</span>
                </KeyValueRow>
                <KeyValueRow k="y_true">
                  <span className="font-mono tabular-nums">
                    {arrayData.y_true ? `${arrayData.y_true.length} values` : "—"}
                  </span>
                </KeyValueRow>
                <KeyValueRow k="y_pred">
                  <span className="font-mono tabular-nums">
                    {arrayData.y_pred ? `${arrayData.y_pred.length} values` : "—"}
                  </span>
                </KeyValueRow>
                {arrayData.y_proba && (
                  <KeyValueRow k="y_proba">
                    <span className="font-mono tabular-nums">
                      {arrayData.y_proba.length} values
                    </span>
                  </KeyValueRow>
                )}
              </div>
            )}
          </DetailsSection>
        </div>
      </div>
    </div>
  );
}
