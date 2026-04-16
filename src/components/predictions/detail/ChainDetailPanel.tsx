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

import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Box,
  ChevronDown,
  Database,
  GitBranch,
  Grid3x3,
  Layers,
  Loader2,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { foldIdBase, foldLabel, foldLabelShort } from "@/lib/fold-utils";
import {
  PARTITION_COLORS,
  normalizePartition,
  partitionBadgeClass,
  type PartitionKey,
} from "@/lib/partitionColors";
import {
  canonicalMetricKey,
  formatMetricName,
  formatMetricValue,
  getMetricAbbreviation,
  metricKeyCandidates,
  orderMetricKeys,
} from "@/lib/scores";
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
import type { ScoreCardType } from "@/types/score-cards";

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
export interface ChainDetailFocus {
  cardType?: ScoreCardType | null;
  foldId?: string | null;
  predictionId?: string | null;
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

interface ChainDetailPanelProps {
  chainId: string;
  metric?: string | null;
  metaHint?: ChainDetailMetaHint;
  focus?: ChainDetailFocus;
  onOpenViewer?: (
    partitions: ViewerPartitionTarget[],
    header: ViewerHeader,
    kind: ChartKind,
  ) => void;
}

type FoldGroup = {
  foldId: string;
  baseFoldId: string;
  isAggregated: boolean;
  kind: "refit" | "cv" | "fold";
  rows: PartitionPrediction[];
  representative: PartitionPrediction | null;
};

const CV_PARTITIONS = ["val", "test", "train"] as const;
type CvPartition = (typeof CV_PARTITIONS)[number];

type CvMetricRow = {
  metric: string;
  values: Record<CvPartition, number | null>;
};

function parseRecord(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
  return typeof value === "object" ? value as Record<string, unknown> : null;
}

function pickRepresentative(rows: PartitionPrediction[]): PartitionPrediction | null {
  return rows.find((row) => row.partition === "test")
    ?? rows.find((row) => row.partition === "val")
    ?? rows.find((row) => row.partition === "train")
    ?? rows[0]
    ?? null;
}

function sortRows(rows: PartitionPrediction[]): PartitionPrediction[] {
  const order: Record<string, number> = { val: 0, test: 1, train: 2 };
  return [...rows].sort((a, b) => (order[a.partition] ?? 99) - (order[b.partition] ?? 99));
}

function foldSortValue(foldId: string): number {
  const base = foldIdBase(foldId);
  if (base === "final") return 0;
  if (base === "avg") return 1;
  if (base === "w_avg") return 2;
  const parsed = Number.parseInt(base, 10);
  return Number.isFinite(parsed) ? 100 + parsed : 1000;
}

function buildFoldGroups(rows: PartitionPrediction[]): FoldGroup[] {
  const grouped = new Map<string, PartitionPrediction[]>();
  for (const row of rows) grouped.set(row.fold_id, [...(grouped.get(row.fold_id) ?? []), row]);
  return [...grouped.entries()]
    .map(([foldId, groupRows]) => {
      const baseFoldId = foldIdBase(foldId);
      return {
        foldId,
        baseFoldId,
        isAggregated: foldId !== baseFoldId,
        kind: baseFoldId === "final" || baseFoldId === "avg" || baseFoldId === "w_avg"
          ? (baseFoldId === "final" ? "refit" : "cv")
          : "fold",
        rows: sortRows(groupRows),
        representative: pickRepresentative(groupRows),
      };
    })
    .sort((a, b) => {
      const byFold = foldSortValue(a.foldId) - foldSortValue(b.foldId);
      if (byFold !== 0) return byFold;
      return Number(a.isAggregated) - Number(b.isAggregated);
    });
}

function resolveInitialFoldId(
  rows: PartitionPrediction[],
  focus: ChainDetailFocus | undefined,
  summary: ChainSummary,
): string {
  if (focus?.predictionId) {
    const match = rows.find((row) => row.prediction_id === focus.predictionId);
    if (match) return match.fold_id;
  }
  if (focus?.foldId) {
    const exact = rows.find((row) => row.fold_id === focus.foldId);
    if (exact) return exact.fold_id;
    const base = foldIdBase(focus.foldId);
    const sameBase = rows.find((row) => foldIdBase(row.fold_id) === base);
    if (sameBase) return sameBase.fold_id;
  }
  if (focus?.cardType === "refit" || summary.final_test_score != null) {
    const finalRow = rows.find((row) => foldIdBase(row.fold_id) === "final");
    if (finalRow) return finalRow.fold_id;
  }
  const avgRow = rows.find((row) => foldIdBase(row.fold_id) === "avg");
  return avgRow?.fold_id ?? rows[0].fold_id;
}

function scoreForPartition(row: PartitionPrediction, partition: string): number | null | undefined {
  if (partition === "val") return row.val_score;
  if (partition === "test") return row.test_score;
  return row.train_score;
}

function metricMap(row: PartitionPrediction): Array<[string, number]> {
  const entries: Array<[string, number]> = [];
  const scores = row.scores as Record<string, unknown> | null | undefined;
  const nested = scores && typeof scores === "object" ? scores[row.partition] : null;
  if (nested && typeof nested === "object") {
    for (const [key, value] of Object.entries(nested as Record<string, unknown>)) {
      const num = Number(value);
      if (Number.isFinite(num)) entries.push([key, num]);
    }
  }
  const primary = (row.metric || "").toLowerCase();
  const scalar = scoreForPartition(row, row.partition);
  if (primary && scalar != null && !entries.some(([key]) => key === primary)) entries.unshift([primary, scalar]);
  return entries.sort(([a], [b]) => {
    if (a === primary) return -1;
    if (b === primary) return 1;
    return a.localeCompare(b);
  });
}

function summarize(values: number[]): { min: number; max: number; mean: number } | null {
  if (values.length === 0) return null;
  let min = values[0];
  let max = values[0];
  let sum = 0;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
  }
  return { min, max, mean: sum / values.length };
}

function residualSummary(yTrue: number[], yPred: number[]): { mean: number; sigma: number } | null {
  const residuals: number[] = [];
  for (let i = 0; i < Math.min(yTrue.length, yPred.length); i += 1) residuals.push(yTrue[i] - yPred[i]);
  if (residuals.length === 0) return null;
  const mean = residuals.reduce((acc, value) => acc + value, 0) / residuals.length;
  const variance = residuals.reduce((acc, value) => acc + (value - mean) ** 2, 0) / residuals.length;
  return { mean, sigma: Math.sqrt(variance) };
}

function getCvMetricValue(
  metrics: Record<string, number> | null | undefined,
  metric: string,
): number | null {
  if (!metrics) return null;
  for (const candidate of metricKeyCandidates(metric)) {
    const num = Number(metrics[candidate]);
    if (Number.isFinite(num)) return num;
  }
  for (const [key, value] of Object.entries(metrics)) {
    if (canonicalMetricKey(key) !== metric) continue;
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function buildCvMetricRows(
  cvScores: Record<string, Record<string, number>> | null | undefined,
  primaryMetric: string | null | undefined,
): CvMetricRow[] {
  if (!cvScores) return [];

  const discovered = new Set<string>();
  for (const partition of CV_PARTITIONS) {
    const metrics = cvScores[partition];
    if (!metrics || typeof metrics !== "object") continue;
    for (const [key, value] of Object.entries(metrics)) {
      const num = Number(value);
      if (!Number.isFinite(num)) continue;
      discovered.add(canonicalMetricKey(key) || key.trim().toLowerCase());
    }
  }

  const knownKeys = orderMetricKeys([...discovered]);
  const remainingKeys = [...discovered]
    .filter((key) => !knownKeys.includes(key))
    .sort((a, b) => a.localeCompare(b));
  const preferredKey = canonicalMetricKey(primaryMetric);
  const orderedKeys = [...new Set([
    ...(preferredKey ? [preferredKey] : []),
    ...knownKeys,
    ...remainingKeys,
  ])].filter((key) => discovered.has(key));

  return orderedKeys.map((metric) => ({
    metric,
    values: {
      val: getCvMetricValue(cvScores.val, metric),
      test: getCvMetricValue(cvScores.test, metric),
      train: getCvMetricValue(cvScores.train, metric),
    },
  }));
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

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <div className="text-sm font-semibold tracking-tight">{title}</div>
        {description && <div className="mt-1 text-[11px] leading-5 text-muted-foreground">{description}</div>}
      </div>
      {children}
    </section>
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

export function ChainDetailPanel({ chainId, metric, metaHint, focus, onOpenViewer }: ChainDetailPanelProps) {
  const [detail, setDetail] = useState<ChainDetailResponse | null>(null);
  const [partitionRows, setPartitionRows] = useState<PartitionPrediction[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [selectedFoldId, setSelectedFoldId] = useState<string>("");
  const [arrayData, setArrayData] = useState<PredictionArraysResponse | null>(null);
  const [loadingArrays, setLoadingArrays] = useState(false);
  const [previewKind, setPreviewKind] = useState<ChartKind>("scatter");

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

  useEffect(() => {
    setPreviewKind((current) => {
      if (taskKind === "classification") return "confusion";
      return current === "confusion" ? "scatter" : current;
    });
  }, [taskKind]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingSummary(true);
      try {
        const [chainDetail, partitions] = await Promise.all([
          getChainDetail(chainId, { metric: metric ?? undefined, dataset_name: metaHint?.datasetName ?? undefined }),
          getChainPartitionDetail(chainId),
        ]);
        if (cancelled) return;
        setDetail(chainDetail);
        setPartitionRows(partitions.predictions);
      } catch (err) {
        if (!cancelled) console.error("Failed to load chain detail:", err);
      } finally {
        if (!cancelled) setLoadingSummary(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [chainId, metric, metaHint?.datasetName]);

  useEffect(() => {
    if (partitionRows.length === 0) return;
    setSelectedFoldId((current) => current && partitionRows.some((row) => row.fold_id === current)
      ? current
      : resolveInitialFoldId(partitionRows, focus, prediction));
  }, [partitionRows, focus, prediction]);

  const foldGroups = useMemo(() => buildFoldGroups(partitionRows), [partitionRows]);
  const selectedGroup = useMemo(
    () => foldGroups.find((group) => group.foldId === selectedFoldId) ?? null,
    [foldGroups, selectedFoldId],
  );
  const selectedPrediction = selectedGroup?.representative ?? null;
  const selectedFoldPartitions = selectedGroup?.rows ?? [];

  useEffect(() => {
    if (!selectedPrediction) {
      setArrayData(null);
      return;
    }
    let cancelled = false;
    async function run() {
      setLoadingArrays(true);
      try {
        const data = await getPredictionArrays(selectedPrediction.prediction_id);
        if (!cancelled) setArrayData(data);
      } catch {
        if (!cancelled) setArrayData(null);
      } finally {
        if (!cancelled) setLoadingArrays(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [selectedPrediction]);

  const chartTargets = useMemo<ViewerPartitionTarget[]>(
    () => selectedFoldPartitions.map((predictionRow) => ({
      predictionId: predictionRow.prediction_id,
      partition: (predictionRow.partition ?? "").toLowerCase(),
      label: predictionRow.partition ?? "",
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
  const canCustomize = !!onOpenViewer && !!chartHeader && chartTargets.length > 0;
  const chartBodyKey = `${previewKind}:${selectedGroup?.foldId ?? "none"}:${chartTargets.map((target) => target.predictionId).join("|")}`;

  const preprocessLabel = prediction.preprocessings || "None";
  const bestParams = useMemo(() => parseRecord(prediction.best_params), [prediction.best_params]);
  const vectorSummaries = useMemo(
    () => chartDatasets.map((dataset) => ({
      dataset,
      observed: summarize(dataset.yTrue),
      predicted: summarize(dataset.yPred),
      residuals: residualSummary(dataset.yTrue, dataset.yPred),
    })),
    [chartDatasets],
  );

  const chartsPlaceholder = (message: string) => (
    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
      {message}
    </div>
  );

  const cvMetricRows = useMemo(
    () => buildCvMetricRows(prediction.cv_scores, prediction.metric),
    [prediction.cv_scores, prediction.metric],
  );
  const primaryCvMetric = useMemo(
    () => canonicalMetricKey(prediction.metric) || cvMetricRows[0]?.metric || "score",
    [prediction.metric, cvMetricRows],
  );
  const primaryCvValues = useMemo(
    () => ({
      val: prediction.cv_val_score ?? cvMetricRows.find((row) => row.metric === primaryCvMetric)?.values.val ?? null,
      test: prediction.cv_test_score ?? cvMetricRows.find((row) => row.metric === primaryCvMetric)?.values.test ?? null,
      train: prediction.cv_train_score ?? cvMetricRows.find((row) => row.metric === primaryCvMetric)?.values.train ?? null,
    }),
    [prediction.cv_val_score, prediction.cv_test_score, prediction.cv_train_score, cvMetricRows, primaryCvMetric],
  );
  const additionalCvMetricRows = useMemo(
    () => cvMetricRows.filter((row) => row.metric !== primaryCvMetric),
    [cvMetricRows, primaryCvMetric],
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
    if (chartDatasets.length === 0) return chartsPlaceholder("Select a related prediction to display charts.");
    if (kind === "scatter") {
      return <PredictionScatterChart className="h-full min-h-[320px] w-full" datasets={chartDatasets} config={panelConfig} variant="panel" />;
    }
    if (kind === "residuals") {
      return <PredictionResidualsChart className="h-full min-h-[320px] w-full" datasets={chartDatasets} config={panelConfig} variant="panel" />;
    }
    return <PredictionConfusionChart className="h-full min-h-[320px] w-full" datasets={chartDatasets} config={panelConfig} variant="panel" />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.06),transparent_32%)]">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/95 px-6 py-4 backdrop-blur">
        <div className="flex items-start gap-3">
          <Box className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <h2 className="truncate font-mono text-base font-semibold tracking-tight">{prediction.model_name ?? prediction.model_class}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Database className="h-3 w-3" />{prediction.dataset_name}</span>
              {prediction.metric && <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{formatMetricName(prediction.metric)}</Badge>}
              {prediction.task_type && <Badge variant="outline" className="h-5 px-1.5 text-[10px] capitalize">{prediction.task_type}</Badge>}
              {selectedGroup && <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{foldLabel(selectedGroup.foldId)}</Badge>}
              <span className="inline-flex items-center gap-1"><Layers className="h-3 w-3" /><span className="truncate max-w-[260px]" title={preprocessLabel}>{preprocessLabel}</span></span>
              <Badge variant={prediction.pipeline_status === "completed" ? "default" : "secondary"} className="h-5 px-1.5 text-[10px]">{prediction.pipeline_status || "unknown"}</Badge>
            </div>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-6 px-6 py-5">
          <HeroMetrics
            cvVal={prediction.cv_val_score}
            cvTest={prediction.cv_test_score}
            cvTrain={prediction.cv_train_score}
            foldCount={prediction.cv_fold_count}
            finalTest={prediction.final_test_score}
            metric={prediction.metric || "score"}
          />

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
            <div className="rounded-2xl border border-border/70 bg-card/60 p-4 shadow-sm">
              <div className="text-sm font-semibold tracking-tight">Prediction structure</div>
              <div className="mt-1 text-[11px] leading-5 text-muted-foreground">One detail surface for refit, CV summaries, and numbered folds.</div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-primary/25 bg-primary/[0.06] p-3"><div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Selected</div><div className="mt-1 text-lg font-semibold">{selectedGroup ? foldLabelShort(selectedGroup.foldId) : "Auto"}</div></div>
                <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3"><div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Refits</div><div className="mt-1 text-lg font-semibold">{foldGroups.filter((group) => group.kind === "refit").length}</div></div>
                <div className="rounded-xl border border-border/70 bg-background/65 p-3"><div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">CV Views</div><div className="mt-1 text-lg font-semibold">{foldGroups.filter((group) => group.kind === "cv").length}</div></div>
                <div className="rounded-xl border border-border/70 bg-background/65 p-3"><div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Folds</div><div className="mt-1 text-lg font-semibold">{foldGroups.filter((group) => group.kind === "fold" && !group.isAggregated).length}</div></div>
              </div>
              {bestParams && Object.keys(bestParams).length > 0 && <div className="mt-4"><div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Best parameters</div><div className="flex flex-wrap gap-2">{Object.entries(bestParams).map(([key, value]) => <Badge key={key} variant="outline" className="h-6 rounded-full px-2 text-[11px] font-mono">{key}={String(value)}</Badge>)}</div></div>}
            </div>

            <div className="rounded-2xl border border-border/70 bg-card/60 p-4 shadow-sm">
              <div className="text-sm font-semibold tracking-tight">Selected focus</div>
              <div className="mt-1 text-[11px] leading-5 text-muted-foreground">The chart preview and detailed metrics below follow this related prediction.</div>
              {selectedGroup ? <div className="mt-4 grid gap-2 sm:grid-cols-3">{selectedGroup.rows.map((row) => <div key={row.prediction_id} className="rounded-xl border border-border/60 bg-background/65 p-3"><div className="flex items-center gap-2"><Badge variant="outline" className={cn("h-4 px-1 text-[9px]", partitionBadgeClass(row.partition))}>{row.partition}</Badge><span className="text-[10px] text-muted-foreground">{row.n_samples ?? "—"} samples</span></div><div className="mt-2 font-mono text-sm font-semibold">{formatMetricValue(scoreForPartition(row, row.partition), row.metric)}</div><div className="mt-1 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{getMetricAbbreviation(row.metric || prediction.metric || "score")}</div></div>)}</div> : <div className="mt-4 rounded-xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">{loadingSummary ? "Loading prediction relationships…" : "No fold-level predictions found."}</div>}
            </div>
          </div>

          <Section title="Related predictions" description="Switch between refit, CV summaries, and numbered folds.">
            {loadingSummary ? <div className="flex items-center justify-center rounded-2xl border border-border/70 bg-card/40 py-10 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading related predictions…</div> : foldGroups.length === 0 ? <div className="rounded-2xl border border-dashed border-border/70 bg-card/40 px-4 py-8 text-center text-sm text-muted-foreground">No related predictions are available for this chain.</div> : <div className="grid gap-3 xl:grid-cols-2">{foldGroups.map((group) => <button key={group.foldId} type="button" onClick={() => setSelectedFoldId(group.foldId)} className={cn("w-full rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md", group.foldId === selectedFoldId ? "border-primary/30 bg-primary/[0.05] ring-2 ring-primary/25" : group.kind === "refit" ? "border-emerald-500/20 bg-emerald-500/[0.04]" : group.kind === "cv" ? "border-blue-500/20 bg-blue-500/[0.04]" : "border-border/70 bg-card/55")}><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{foldLabel(group.foldId)}</span><Badge variant="outline" className="h-5 px-1.5 text-[10px]">{group.rows.length} part.</Badge>{group.isAggregated && <Badge variant="outline" className="h-5 px-1.5 text-[10px] border-purple-500/30 text-purple-500">Aggregated</Badge>}</div><div className="mt-3 grid grid-cols-3 gap-2">{["val", "test", "train"].map((partition) => { const row = group.rows.find((candidate) => candidate.partition === partition); return <div key={partition} className="rounded-xl border border-border/60 bg-background/65 px-3 py-2"><div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{partition}</div><div className="mt-1 font-mono text-sm font-semibold">{row ? formatMetricValue(scoreForPartition(row, partition), row.metric) : "—"}</div></div>; })}</div><div className="mt-3 flex flex-wrap gap-2">{group.rows.map((row) => <span key={row.prediction_id} className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/65 px-2 py-1 text-[10px] text-muted-foreground"><Badge variant="outline" className={cn("h-4 px-1 text-[9px]", partitionBadgeClass(row.partition))}>{row.partition}</Badge><span className="font-mono">{row.n_samples ?? "—"}</span></span>)}</div></button>)}</div>}
          </Section>

          <Section title="Chart preview" description={selectedGroup ? `${foldLabel(selectedGroup.foldId)} · ${selectedFoldPartitions.length} partition${selectedFoldPartitions.length === 1 ? "" : "s"}` : "Select a related prediction to display its chart preview."}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <PartitionLegend partitions={chartTargets} />
              {taskKind === "regression" && (
                <div className="inline-flex w-full rounded-xl border border-border/70 bg-card/50 p-1 lg:w-auto">
                  {[
                    { kind: "scatter" as const, label: "Predicted vs Actual", icon: <TrendingUp className="h-3.5 w-3.5" /> },
                    { kind: "residuals" as const, label: "Residuals", icon: <BarChart3 className="h-3.5 w-3.5" /> },
                  ].map((option) => (
                    <button
                      key={option.kind}
                      type="button"
                      onClick={() => setPreviewKind(option.kind)}
                      className={cn(
                        "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors lg:flex-none",
                        previewKind === option.kind
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                      )}
                    >
                      {option.icon}
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <ChartTile
              title={
                previewKind === "confusion"
                  ? "Confusion matrix"
                  : previewKind === "residuals"
                  ? "Residuals"
                  : "Predicted vs Actual"
              }
              icon={
                previewKind === "confusion"
                  ? <Grid3x3 className="h-3.5 w-3.5" />
                  : previewKind === "residuals"
                  ? <BarChart3 className="h-3.5 w-3.5" />
                  : <TrendingUp className="h-3.5 w-3.5" />
              }
              subtitle={
                previewKind === "confusion"
                  ? "Shared chart-view rendering without the configuration controls"
                  : previewKind === "residuals"
                  ? "Large preview of residual spread for the selected prediction"
                  : "Large preview using the same chart-view styling"
              }
              onCustomize={canCustomize ? () => handleCustomize(previewKind) : undefined}
              height="h-[380px] md:h-[420px] xl:h-[440px]"
              className="overflow-hidden"
            >
              <ChartBody key={chartBodyKey} kind={previewKind} />
            </ChartTile>
          </Section>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
            <div className="rounded-2xl border border-border/70 bg-card/60 p-4 shadow-sm">
              <div className="text-sm font-semibold tracking-tight">Selected prediction breakdown</div>
              <div className="mt-1 text-[11px] leading-5 text-muted-foreground">{selectedGroup ? `Partition metrics for ${foldLabel(selectedGroup.foldId)}.` : "Choose a related prediction to inspect its metric map."}</div>
              {selectedFoldPartitions.length === 0 ? <div className="mt-4 rounded-xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">No partition-level metrics are available for this selection.</div> : <div className="mt-4 space-y-3">{selectedFoldPartitions.map((row) => <div key={row.prediction_id} className="rounded-xl border border-border/60 bg-background/65 p-4"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className={cn("h-5 px-1.5 text-[10px]", partitionBadgeClass(row.partition))}>{row.partition}</Badge><span className="text-[11px] text-muted-foreground">{row.n_samples ?? "—"} samples</span>{row.n_features != null && <span className="text-[11px] text-muted-foreground">· {row.n_features} features</span>}</div><div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{metricMap(row).length > 0 ? metricMap(row).map(([key, value]) => <div key={key} className="rounded-lg border border-border/50 bg-card/70 px-3 py-2"><div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{getMetricAbbreviation(key)}</div><div className="mt-1 font-mono text-sm font-semibold">{formatMetricValue(value, key)}</div></div>) : <div className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-sm text-muted-foreground">No detailed metric map stored.</div>}</div></div>)}</div>}
            </div>

            <div className="rounded-2xl border border-border/70 bg-card/60 p-4 shadow-sm">
              <div className="text-sm font-semibold tracking-tight">Pipeline and identity</div>
              <div className="mt-1 text-[11px] leading-5 text-muted-foreground">Model metadata, pipeline context, and summary CV metrics.</div>
              <div className="mt-4 space-y-2 text-sm">
                <KeyValueRow k="Model"><span className="font-medium">{prediction.model_name ?? "—"}</span></KeyValueRow>
                <KeyValueRow k="Class">{prediction.model_class || "—"}</KeyValueRow>
                <KeyValueRow k="Dataset"><span className="inline-flex items-center gap-1"><Database className="h-3 w-3" /> {prediction.dataset_name || "—"}</span></KeyValueRow>
                <KeyValueRow k="Metric"><Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{formatMetricName(prediction.metric)}</Badge></KeyValueRow>
                {prediction.task_type && <KeyValueRow k="Task"><span className="capitalize">{prediction.task_type}</span></KeyValueRow>}
                <KeyValueRow k="Preprocessing">{preprocessLabel}</KeyValueRow>
                {detail?.pipeline && <><KeyValueRow k="Pipeline">{detail.pipeline.name || "—"}</KeyValueRow><KeyValueRow k="Status"><Badge variant={detail.pipeline.status === "completed" ? "default" : "secondary"} className="h-5 px-1.5 text-[10px]">{detail.pipeline.status || "unknown"}</Badge></KeyValueRow></>}
              </div>
              {cvMetricRows.length > 0 && (
                <div className="mt-4 rounded-xl border border-border/60 bg-background/65 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <GitBranch className="h-3.5 w-3.5" />
                      Cross-validation summary
                    </div>
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                      {prediction.cv_fold_count || 0} fold{prediction.cv_fold_count === 1 ? "" : "s"} averaged
                    </Badge>
                  </div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    {CV_PARTITIONS.map((partition) => (
                      <div
                        key={partition}
                        className={cn(
                          "rounded-xl border px-3 py-3",
                          partition === "val"
                            ? "border-primary/25 bg-primary/[0.06]"
                            : "border-border/60 bg-card/70",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant="outline" className={cn("h-5 px-1.5 text-[10px]", partitionBadgeClass(partition))}>
                            {partition}
                          </Badge>
                          <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                            {getMetricAbbreviation(primaryCvMetric)}
                          </span>
                        </div>
                        <div className="mt-3 font-mono text-lg font-semibold">
                          {formatMetricValue(primaryCvValues[partition], primaryCvMetric)}
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {formatMetricName(primaryCvMetric)}
                        </div>
                      </div>
                    ))}
                  </div>

                  {additionalCvMetricRows.length > 0 && (
                    <>
                      <div className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Additional averaged metrics
                      </div>
                      <div className="mt-2 overflow-x-auto">
                        <div className="min-w-[520px] overflow-hidden rounded-xl border border-border/60 bg-card/70">
                          <div className="grid grid-cols-[minmax(150px,1.35fr)_repeat(3,minmax(92px,1fr))] border-b border-border/60 bg-muted/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                            <div>Metric</div>
                            <div className="text-right">Val</div>
                            <div className="text-right">Test</div>
                            <div className="text-right">Train</div>
                          </div>
                          {additionalCvMetricRows.map((row, index) => (
                            <div
                              key={row.metric}
                              className={cn(
                                "grid grid-cols-[minmax(150px,1.35fr)_repeat(3,minmax(92px,1fr))] items-center gap-3 px-3 py-2.5 text-sm",
                                index > 0 && "border-t border-border/50",
                              )}
                            >
                              <div className="min-w-0">
                                <div className="truncate font-medium">{formatMetricName(row.metric)}</div>
                                <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                                  {getMetricAbbreviation(row.metric)}
                                </div>
                              </div>
                              {CV_PARTITIONS.map((partition) => (
                                <div key={partition} className="text-right font-mono text-sm font-semibold tabular-nums">
                                  {formatMetricValue(row.values[partition], row.metric)}
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          <DetailsSection title="Raw vectors" icon={<Layers className="h-3.5 w-3.5" />}>
            {!selectedPrediction ? <div className="text-xs text-muted-foreground">Select a related prediction above to inspect raw-vector summaries.</div> : loadingArrays || chartsLoading ? <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading vector summaries…</div> : vectorSummaries.length === 0 ? <div className="text-xs text-muted-foreground">No vector data is available for the current selection.</div> : <div className="space-y-4">
              <div className="grid gap-3 xl:grid-cols-2">{vectorSummaries.map(({ dataset, observed, predicted, residuals }) => <div key={dataset.predictionId} className="rounded-xl border border-border/60 bg-background/65 p-4"><div className="flex items-center gap-2"><Badge variant="outline" className={cn("h-5 px-1.5 text-[10px]", partitionBadgeClass(dataset.partition))}>{dataset.label}</Badge><span className="text-[11px] text-muted-foreground">{dataset.nSamples} samples</span></div><div className="mt-3 grid gap-2 sm:grid-cols-3"><div className="rounded-lg border border-border/50 bg-card/70 px-3 py-2"><div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">y_true</div><div className="mt-1 text-[10px] text-muted-foreground">{observed ? `${formatMetricValue(observed.min, prediction.metric)} → ${formatMetricValue(observed.max, prediction.metric)}` : "—"}</div><div className="font-mono text-sm font-semibold">{observed ? formatMetricValue(observed.mean, prediction.metric) : "—"}</div></div><div className="rounded-lg border border-border/50 bg-card/70 px-3 py-2"><div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">y_pred</div><div className="mt-1 text-[10px] text-muted-foreground">{predicted ? `${formatMetricValue(predicted.min, prediction.metric)} → ${formatMetricValue(predicted.max, prediction.metric)}` : "—"}</div><div className="font-mono text-sm font-semibold">{predicted ? formatMetricValue(predicted.mean, prediction.metric) : "—"}</div></div><div className="rounded-lg border border-border/50 bg-card/70 px-3 py-2"><div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">residuals</div><div className="mt-1 text-[10px] text-muted-foreground">mean</div><div className="font-mono text-sm font-semibold">{residuals ? formatMetricValue(residuals.mean, prediction.metric) : "—"}</div><div className="mt-1 text-[10px] text-muted-foreground">σ {residuals ? formatMetricValue(residuals.sigma, prediction.metric) : "—"}</div></div></div></div>)}</div>
              {arrayData && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div className="rounded-lg border border-border/60 bg-background/65 px-3 py-2"><div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Prediction ID</div><div className="mt-1 truncate font-mono text-xs" title={arrayData.prediction_id}>{arrayData.prediction_id}</div></div><div className="rounded-lg border border-border/60 bg-background/65 px-3 py-2"><div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Samples</div><div className="mt-1 font-mono text-sm font-semibold">{arrayData.n_samples}</div></div><div className="rounded-lg border border-border/60 bg-background/65 px-3 py-2"><div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">y_proba</div><div className="mt-1 font-mono text-sm font-semibold">{arrayData.y_proba ? arrayData.y_proba.length : "—"}</div></div><div className="rounded-lg border border-border/60 bg-background/65 px-3 py-2"><div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Extra vectors</div><div className="mt-1 text-[11px] text-muted-foreground">sample_indices {arrayData.sample_indices ? arrayData.sample_indices.length : "—"}<br />weights {arrayData.weights ? arrayData.weights.length : "—"}</div></div></div>}
            </div>}
          </DetailsSection>
        </div>
      </div>
    </div>
  );
}
