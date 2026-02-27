/**
 * ModelDetailSheet — slide-over for viewing detailed model metrics,
 * per-fold scores, obs/pred scatter, and residuals.
 *
 * Opened from RunItem model cards or the AllModelsPanel table.
 */

import { useState, useEffect, useMemo, Fragment } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Box, Target, BarChart3, Layers, Loader2, ScatterChart as ScatterIcon,
  TrendingDown, Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMetricValue, extractFinalMetrics, extractCVMetrics, extractCVOnlyMetrics, type MetricEntry } from "@/lib/scores";
import { getChainDetail, getChainPartitionDetail, getPredictionArrays } from "@/api/client";
import type {
  ChainDetailResponse, PartitionPrediction, PredictionArraysResponse,
} from "@/types/aggregated-predictions";
import type { TopChainResult, AllChainEntry } from "@/types/enriched-runs";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  Cell, ReferenceLine, ResponsiveContainer,
} from "recharts";

// ============================================================================
// Types
// ============================================================================

type ChainLike = (TopChainResult | AllChainEntry) & { metric?: string | null };

interface ModelDetailSheetProps {
  chain: ChainLike | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskType?: string | null;
  datasetName?: string;
}

// ============================================================================
// Partition colors
// ============================================================================

const PARTITION_COLORS: Record<string, { dot: string; bg: string; text: string; border: string }> = {
  val: { dot: "hsl(221, 83%, 53%)", bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-300", border: "border-blue-300 dark:border-blue-700" },
  test: { dot: "hsl(142, 71%, 45%)", bg: "bg-green-100 dark:bg-green-900/30", text: "text-green-700 dark:text-green-300", border: "border-green-300 dark:border-green-700" },
  train: { dot: "hsl(25, 95%, 53%)", bg: "bg-orange-100 dark:bg-orange-900/30", text: "text-orange-700 dark:text-orange-300", border: "border-orange-300 dark:border-orange-700" },
  final: { dot: "hsl(215, 16%, 47%)", bg: "bg-slate-100 dark:bg-slate-900/30", text: "text-slate-700 dark:text-slate-300", border: "border-slate-300 dark:border-slate-700" },
};

function PartitionBadge({ partition }: { partition: string }) {
  const c = PARTITION_COLORS[partition];
  return (
    <Badge variant="outline" className={cn("text-xs", c?.bg, c?.text, c?.border)}>
      {partition}
    </Badge>
  );
}

function fmtScore(value: number | null | undefined): string {
  if (value == null) return "\u2014";
  return value.toFixed(4);
}

// ============================================================================
// Helpers
// ============================================================================

function MetricsGrid({ metrics, className }: { metrics: MetricEntry[]; className?: string }) {
  if (metrics.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-x-3 gap-y-1", className)}>
      {metrics.map((m, i) => (
        <div key={`${m.label}-${i}`} className="text-center min-w-0">
          <div className="text-muted-foreground uppercase text-[9px] font-medium leading-tight">{m.label}</div>
          <div className={cn("font-mono text-xs leading-tight", m.highlight ? "font-bold text-foreground" : "text-foreground/80")}>
            {formatMetricValue(m.value, m.key)}
          </div>
        </div>
      ))}
    </div>
  );
}

function BestParamsBadges({ params }: { params: Record<string, unknown> | null | undefined }) {
  if (!params || Object.keys(params).length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {Object.entries(params).map(([k, v]) => (
        <Badge key={k} variant="secondary" className="text-[10px] font-mono gap-0.5">
          <Settings2 className="h-2.5 w-2.5" />
          {k}={String(v)}
        </Badge>
      ))}
    </div>
  );
}

/** Adapt TopChainResult to ChainScores format expected by extractors. */
function toChainScores(chain: ChainLike) {
  // TopChainResult uses avg_val_score / scores.val
  // AllChainEntry uses cv_val_score / cv_scores
  const isAllChain = "cv_val_score" in chain;
  return {
    final_test_score: chain.final_test_score,
    final_train_score: chain.final_train_score,
    final_scores: (chain.final_scores ?? {}) as Record<string, number>,
    avg_val_score: isAllChain ? (chain as AllChainEntry).cv_val_score : (chain as TopChainResult).avg_val_score,
    avg_test_score: isAllChain ? (chain as AllChainEntry).cv_test_score : (chain as TopChainResult).avg_test_score,
    avg_train_score: isAllChain ? (chain as AllChainEntry).cv_train_score : (chain as TopChainResult).avg_train_score,
    scores: isAllChain
      ? (chain as AllChainEntry).cv_scores ?? {}
      : (chain as TopChainResult).scores ?? {},
    metric: chain.metric,
  };
}

// ============================================================================
// Component
// ============================================================================

export function ModelDetailSheet({ chain, open, onOpenChange, taskType, datasetName }: ModelDetailSheetProps) {
  const [detail, setDetail] = useState<ChainDetailResponse | null>(null);
  const [partitionRows, setPartitionRows] = useState<PartitionPrediction[]>([]);
  const [partitionFilter, setPartitionFilter] = useState("all");
  const [loading, setLoading] = useState(false);

  const [selectedFoldId, setSelectedFoldId] = useState<string>("");
  const [activePartitions, setActivePartitions] = useState<Set<string>>(new Set(["train", "val", "test"]));
  const [arraysByPredictionId, setArraysByPredictionId] = useState<Record<string, PredictionArraysResponse>>({});
  const [loadingFoldArrays, setLoadingFoldArrays] = useState(false);

  // Load chain detail when opened
  useEffect(() => {
    if (!open || !chain) {
      setDetail(null);
      setPartitionRows([]);
      setSelectedFoldId("");
      setArraysByPredictionId({});
      setActivePartitions(new Set(["train", "val", "test"]));
      return;
    }
    async function load() {
      if (!chain) return;
      setLoading(true);
      try {
        const [chainDetail, partitions] = await Promise.all([
          getChainDetail(chain.chain_id, { metric: chain.metric ?? undefined, dataset_name: datasetName }),
          getChainPartitionDetail(chain.chain_id),
        ]);
        setDetail(chainDetail);
        setPartitionRows(partitions.predictions);
        const foldIds = Array.from(new Set(partitions.predictions.map((row) => row.fold_id)))
          .sort((a, b) => {
            const toOrderValue = (foldId: string): number => {
              if (foldId.toLowerCase() === "final") return Number.MAX_SAFE_INTEGER;
              const parsed = Number(foldId.replace(/[^\d.-]/g, ""));
              return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER - 1;
            };
            return toOrderValue(a) - toOrderValue(b);
          });
        setSelectedFoldId(foldIds[0] || "");
      } catch (err) {
        console.error("Failed to load chain detail:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [open, chain, datasetName]);

  const filteredRows = partitionFilter === "all"
    ? partitionRows
    : partitionRows.filter((r) => r.partition === partitionFilter);

  const foldRows = useMemo(
    () => partitionRows.filter((row) => row.fold_id === selectedFoldId),
    [partitionRows, selectedFoldId],
  );

  const foldIds = useMemo(
    () => Array.from(new Set(partitionRows.map((row) => row.fold_id))).sort((a, b) => {
      const toOrderValue = (foldId: string): number => {
        if (foldId.toLowerCase() === "final") return Number.MAX_SAFE_INTEGER;
        const parsed = Number(foldId.replace(/[^\d.-]/g, ""));
        return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER - 1;
      };
      return toOrderValue(a) - toOrderValue(b);
    }),
    [partitionRows],
  );

  useEffect(() => {
    if (!foldIds.length) {
      setSelectedFoldId("");
      return;
    }
    if (!selectedFoldId || !foldIds.includes(selectedFoldId)) {
      setSelectedFoldId(foldIds[0]);
    }
  }, [foldIds, selectedFoldId]);

  const availablePartitions = useMemo(
    () => Array.from(new Set(partitionRows.map((row) => row.partition))),
    [partitionRows],
  );

  useEffect(() => {
    if (availablePartitions.length === 0) return;
    setActivePartitions((prev) => {
      const next = new Set(prev);
      for (const partition of availablePartitions) {
        if (!next.has(partition) && (partition === "train" || partition === "val" || partition === "test")) {
          next.add(partition);
        }
      }
      return next;
    });
  }, [availablePartitions]);

  const togglePartition = (partition: string) => {
    setActivePartitions((prev) => {
      const next = new Set(prev);
      if (next.has(partition)) {
        next.delete(partition);
      } else {
        next.add(partition);
      }
      return next;
    });
  };

  // Load arrays for all partition rows of the selected fold
  useEffect(() => {
    if (!selectedFoldId || foldRows.length === 0) {
      setLoadingFoldArrays(false);
      return;
    }
    const missingRows = foldRows.filter((row) => !arraysByPredictionId[row.prediction_id]);
    if (missingRows.length === 0) {
      setLoadingFoldArrays(false);
      return;
    }

    let cancelled = false;
    setLoadingFoldArrays(true);
    Promise.all(
      missingRows.map(async (row) => {
        try {
          const arrays = await getPredictionArrays(row.prediction_id);
          return { predictionId: row.prediction_id, arrays };
        } catch {
          return null;
        }
      }),
    )
      .then((results) => {
        if (cancelled) return;
        setArraysByPredictionId((prev) => {
          const next = { ...prev };
          for (const result of results) {
            if (result) {
              next[result.predictionId] = result.arrays;
            }
          }
          return next;
        });
      })
      .finally(() => {
        if (!cancelled) setLoadingFoldArrays(false);
      });

    return () => { cancelled = true; };
  }, [arraysByPredictionId, foldRows, selectedFoldId]);

  if (!chain) return null;

  const hasFinal = chain.final_test_score != null;
  const chainScores = toChainScores(chain);
  const finalMetrics = extractFinalMetrics(chainScores, taskType ?? null);
  const cvMetrics = hasFinal ? extractCVMetrics(chainScores, taskType ?? null) : extractCVOnlyMetrics(chainScores, taskType ?? null);
  const bestParams = chain.best_params as Record<string, unknown> | null | undefined;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-hidden flex flex-col">
        <SheetHeader className="shrink-0 pb-2">
          <SheetTitle className="flex items-center gap-2">
            <Box className="h-5 w-5 text-muted-foreground" />
            {chain.model_name}
          </SheetTitle>
          <SheetDescription className="flex items-center gap-2 flex-wrap">
            {chain.preprocessings && <span>{chain.preprocessings}</span>}
            {datasetName && <><span className="text-muted-foreground/40">|</span><span>{datasetName}</span></>}
            {hasFinal && <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Refit</Badge>}
          </SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="overview" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-4 shrink-0">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="folds">Folds</TabsTrigger>
            <TabsTrigger value="scatter">Scatter</TabsTrigger>
            <TabsTrigger value="residuals">Residuals</TabsTrigger>
          </TabsList>

          {/* ===== Overview Tab ===== */}
          <TabsContent value="overview" className="flex-1 overflow-y-auto mt-3 space-y-4 pr-1">
            {/* Best params */}
            {bestParams && Object.keys(bestParams).length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <Settings2 className="h-4 w-4" /> Best Parameters
                </h4>
                <BestParamsBadges params={bestParams} />
              </div>
            )}

            {/* Final scores */}
            {hasFinal && finalMetrics.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <Target className="h-4 w-4 text-emerald-500" /> Final (Refit) Scores
                </h4>
                <div className="p-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5">
                  <MetricsGrid metrics={finalMetrics} />
                </div>
              </div>
            )}

            {/* CV scores */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <BarChart3 className="h-4 w-4" /> {hasFinal ? "CV Scores" : "Scores"}
              </h4>
              <div className={cn("p-3 rounded-lg border", hasFinal ? "bg-muted/20 border-border/50" : "bg-card")}>
                <MetricsGrid metrics={cvMetrics} className={hasFinal ? "opacity-80" : undefined} />
              </div>
            </div>

            {/* Fold count + train score */}
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-lg border p-3 text-center">
                <div className="text-muted-foreground text-[10px] uppercase font-medium">Folds</div>
                <div className="text-lg font-bold font-mono">
                  {"cv_fold_count" in chain ? (chain as AllChainEntry).cv_fold_count : (chain as TopChainResult).fold_count}
                </div>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <div className="text-muted-foreground text-[10px] uppercase font-medium">CV Val</div>
                <div className="text-lg font-bold font-mono text-chart-1">
                  {fmtScore("cv_val_score" in chain ? (chain as AllChainEntry).cv_val_score : (chain as TopChainResult).avg_val_score)}
                </div>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <div className="text-muted-foreground text-[10px] uppercase font-medium">CV Train</div>
                <div className="text-lg font-bold font-mono text-muted-foreground">
                  {fmtScore("cv_train_score" in chain ? (chain as AllChainEntry).cv_train_score : (chain as TopChainResult).avg_train_score)}
                </div>
              </div>
            </div>

            {/* Multi-metric CV breakdown */}
            {(() => {
              const scores = "cv_scores" in chain ? (chain as AllChainEntry).cv_scores : (chain as TopChainResult).scores;
              if (!scores || Object.keys(scores).length === 0) return null;
              return (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">Multi-metric Breakdown</h4>
                  <div className="rounded-lg border p-3">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      {Object.entries(scores).map(([partition, metrics]) => (
                        <Fragment key={partition}>
                          <div className="col-span-2 mt-1 first:mt-0">
                            <PartitionBadge partition={partition} />
                          </div>
                          {Object.entries(metrics as Record<string, number>).map(([m, v]) => (
                            <Fragment key={m}>
                              <div className="text-muted-foreground pl-2 uppercase text-[10px]">{m}</div>
                              <div className="tabular-nums font-mono">{formatMetricValue(v, m)}</div>
                            </Fragment>
                          ))}
                        </Fragment>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Pipeline info */}
            {detail?.pipeline && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <Layers className="h-4 w-4" /> Pipeline
                </h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="text-muted-foreground">Name</div>
                  <div>{detail.pipeline.name || "\u2014"}</div>
                  <div className="text-muted-foreground">Status</div>
                  <div><Badge variant={detail.pipeline.status === "completed" ? "default" : "secondary"}>{detail.pipeline.status || "unknown"}</Badge></div>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ===== Folds Tab ===== */}
          <TabsContent value="folds" className="flex-1 overflow-hidden mt-3 flex flex-col">
            <div className="flex items-center justify-between mb-2 shrink-0">
              <h4 className="text-sm font-medium">Per-Fold Scores</h4>
              <Select value={partitionFilter} onValueChange={setPartitionFilter}>
                <SelectTrigger className="w-[120px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="val">Validation</SelectItem>
                  <SelectItem value="test">Test</SelectItem>
                  <SelectItem value="train">Train</SelectItem>
                  <SelectItem value="final">Final</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-8 flex-1">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <ScrollArea className="flex-1">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20 text-xs">Fold</TableHead>
                      <TableHead className="w-16 text-xs">Part.</TableHead>
                      <TableHead className="text-right text-xs">Val Score</TableHead>
                      <TableHead className="text-right text-xs">Test Score</TableHead>
                      <TableHead className="text-right text-xs">Train Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRows.map((row) => (
                      <TableRow
                        key={row.prediction_id}
                        className={cn("cursor-pointer transition-colors", selectedFoldId === row.fold_id && "bg-accent/40")}
                        onClick={() => setSelectedFoldId(row.fold_id)}
                      >
                        <TableCell className="text-xs font-mono">{row.fold_id}</TableCell>
                        <TableCell><PartitionBadge partition={row.partition} /></TableCell>
                        <TableCell className="text-right tabular-nums text-xs font-mono">{fmtScore(row.val_score)}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs font-mono">{fmtScore(row.test_score)}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs font-mono">{fmtScore(row.train_score)}</TableCell>
                      </TableRow>
                    ))}
                    {filteredRows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-8 text-xs">
                          No fold predictions found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </TabsContent>

          {/* ===== Scatter Tab (Obs vs Pred) ===== */}
          <TabsContent value="scatter" className="flex-1 overflow-y-auto mt-3">
            <ScatterTabContent
              partitionRows={partitionRows}
              foldIds={foldIds}
              selectedFoldId={selectedFoldId}
              onSelectFold={setSelectedFoldId}
              activePartitions={activePartitions}
              onTogglePartition={togglePartition}
              arraysByPredictionId={arraysByPredictionId}
              loadingArrays={loadingFoldArrays}
              mode="scatter"
            />
          </TabsContent>

          {/* ===== Residuals Tab ===== */}
          <TabsContent value="residuals" className="flex-1 overflow-y-auto mt-3">
            <ScatterTabContent
              partitionRows={partitionRows}
              foldIds={foldIds}
              selectedFoldId={selectedFoldId}
              onSelectFold={setSelectedFoldId}
              activePartitions={activePartitions}
              onTogglePartition={togglePartition}
              arraysByPredictionId={arraysByPredictionId}
              loadingArrays={loadingFoldArrays}
              mode="residuals"
            />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

// ============================================================================
// Scatter / Residuals Tab Content
// ============================================================================

function ScatterTabContent({
  partitionRows,
  foldIds,
  selectedFoldId,
  onSelectFold,
  activePartitions,
  onTogglePartition,
  arraysByPredictionId,
  loadingArrays,
  mode,
}: {
  partitionRows: PartitionPrediction[];
  foldIds: string[];
  selectedFoldId: string;
  onSelectFold: (foldId: string) => void;
  activePartitions: Set<string>;
  onTogglePartition: (partition: string) => void;
  arraysByPredictionId: Record<string, PredictionArraysResponse>;
  loadingArrays: boolean;
  mode: "scatter" | "residuals";
}) {
  const sortedPartitions = useMemo(() => {
    const order = (partition: string): number => {
      if (partition === "train") return 0;
      if (partition === "val") return 1;
      if (partition === "test") return 2;
      return 3;
    };
    return Array.from(new Set(partitionRows.map((row) => row.partition))).sort((a, b) => order(a) - order(b));
  }, [partitionRows]);

  const foldRows = useMemo(
    () => partitionRows.filter((row) => row.fold_id === selectedFoldId),
    [partitionRows, selectedFoldId],
  );

  type ChartPoint = {
    observed: number;
    predicted: number;
    residual: number;
    partition: string;
    foldId: string;
  };

  const points = useMemo(() => {
    const out: ChartPoint[] = [];
    for (const row of foldRows) {
      if (!activePartitions.has(row.partition)) continue;
      const arrays = arraysByPredictionId[row.prediction_id];
      if (!arrays?.y_true || !arrays?.y_pred) continue;
      for (let i = 0; i < arrays.y_true.length; i += 1) {
        const observed = arrays.y_true[i];
        const predicted = arrays.y_pred[i];
        out.push({
          observed,
          predicted,
          residual: observed - predicted,
          partition: row.partition,
          foldId: row.fold_id,
        });
      }
    }
    return out;
  }, [foldRows, activePartitions, arraysByPredictionId]);

  if (partitionRows.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        No prediction data available
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={selectedFoldId || undefined} onValueChange={onSelectFold}>
          <SelectTrigger className="w-[180px] h-8 text-xs">
            <SelectValue placeholder="Select fold" />
          </SelectTrigger>
          <SelectContent>
            {foldIds.map((foldId) => (
              <SelectItem key={foldId} value={foldId}>
                {foldId === "final" ? "final (refit)" : foldId}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1 flex-wrap">
          {sortedPartitions.map((partition) => {
            const active = activePartitions.has(partition);
            return (
              <Button
                key={partition}
                size="sm"
                variant={active ? "default" : "outline"}
                className="h-7 text-[10px] px-2"
                onClick={() => onTogglePartition(partition)}
              >
                {partition}
              </Button>
            );
          })}
        </div>
        <span className="text-[10px] text-muted-foreground ml-auto">{points.length} points</span>
      </div>

      {loadingArrays && (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground ml-2">Loading arrays for selected fold...</span>
        </div>
      )}

      {!loadingArrays && points.length === 0 && (
        <div className="text-center text-sm text-muted-foreground py-8">
          No array data available for this fold and partition selection.
        </div>
      )}

      {!loadingArrays && points.length > 0 && (
        mode === "scatter"
          ? <ObsPredChart points={points} foldId={selectedFoldId} />
          : <ResidualsChart points={points} foldId={selectedFoldId} />
      )}
    </div>
  );
}

// ============================================================================
// Obs vs Pred Chart
// ============================================================================

function ObsPredChart({ points, foldId }: {
  points: Array<{ observed: number; predicted: number; residual: number; partition: string }>;
  foldId?: string;
}) {
  const { domain, stats, pointsByPartition } = useMemo(() => {
    const observed = points.map((p) => p.observed);
    const predicted = points.map((p) => p.predicted);
    const all = [...observed, ...predicted];
    const min = Math.min(...all);
    const max = Math.max(...all);
    const pad = (max - min) * 0.05 || 0.1;

    const mean = observed.reduce((a, b) => a + b, 0) / observed.length;
    const ssRes = observed.reduce((s, truth, i) => s + (truth - predicted[i]) ** 2, 0);
    const ssTot = observed.reduce((s, truth) => s + (truth - mean) ** 2, 0);
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
    const rmse = Math.sqrt(ssRes / observed.length);

    const grouped: Record<string, Array<{ x: number; y: number; partition: string }>> = {};
    for (const point of points) {
      if (!grouped[point.partition]) grouped[point.partition] = [];
      grouped[point.partition].push({ x: point.observed, y: point.predicted, partition: point.partition });
    }

    return {
      domain: [min - pad, max + pad] as [number, number],
      stats: { r2, rmse, n: observed.length },
      pointsByPartition: grouped,
    };
  }, [points]);

  const orderedPartitions = Object.keys(pointsByPartition).sort((a, b) => {
    const rank = (partition: string) => {
      if (partition === "train") return 0;
      if (partition === "val") return 1;
      if (partition === "test") return 2;
      return 3;
    };
    return rank(a) - rank(b);
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <ScatterIcon className="h-4 w-4" /> Observed vs Predicted
        </h4>
        <div className="flex items-center gap-2">
          {orderedPartitions.map((partition) => (
            <PartitionBadge key={partition} partition={partition} />
          ))}
          {foldId && <Badge variant="outline" className="text-[10px]">Fold {foldId}</Badge>}
        </div>
      </div>
      <div className="text-xs text-muted-foreground font-mono">
        R² = {stats.r2.toFixed(4)} | RMSE = {stats.rmse.toFixed(4)} | n = {stats.n}
      </div>
      <div className="h-[350px]">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 10, bottom: 30, left: 40 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis type="number" dataKey="x" domain={domain} name="Observed"
              label={{ value: "Observed", position: "bottom", offset: 15, style: { fontSize: 12 } }}
              tick={{ fontSize: 10 }} />
            <YAxis type="number" dataKey="y" domain={domain} name="Predicted"
              label={{ value: "Predicted", angle: -90, position: "left", offset: 25, style: { fontSize: 12 } }}
              tick={{ fontSize: 10 }} />
            <RechartsTooltip
              content={({ payload }) => {
                if (!payload?.[0]) return null;
                const d = payload[0].payload;
                return (
                  <div className="bg-popover text-popover-foreground border rounded-md p-2 text-xs shadow-lg">
                    <div>Partition: {d.partition}</div>
                    <div>Obs: {d.x?.toFixed(4)}</div>
                    <div>Pred: {d.y?.toFixed(4)}</div>
                    <div>Residual: {(d.x - d.y)?.toFixed(4)}</div>
                  </div>
                );
              }}
            />
            <ReferenceLine
              segment={[{ x: domain[0], y: domain[0] }, { x: domain[1], y: domain[1] }]}
              stroke="hsl(var(--muted-foreground))" strokeDasharray="5 5" strokeWidth={1}
            />
            {orderedPartitions.map((partition) => (
              <Scatter key={partition} data={pointsByPartition[partition]} isAnimationActive={false}>
                {pointsByPartition[partition].map((_, i) => (
                  <Cell key={`${partition}-${i}`} fill={PARTITION_COLORS[partition]?.dot || "#666"} fillOpacity={0.65} r={3} />
                ))}
              </Scatter>
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ============================================================================
// Residuals Chart
// ============================================================================

function ResidualsChart({ points, foldId }: {
  points: Array<{ observed: number; predicted: number; residual: number; partition: string }>;
  foldId?: string;
}) {
  const { xDomain, yDomain, stats, pointsByPartition } = useMemo(() => {
    const predicted = points.map((p) => p.predicted);
    const residuals = points.map((p) => p.residual);

    const xMin = Math.min(...predicted);
    const xMax = Math.max(...predicted);
    const xPad = (xMax - xMin) * 0.05 || 0.1;

    const mean = residuals.reduce((a, b) => a + b, 0) / residuals.length;
    const std = Math.sqrt(residuals.reduce((s, r) => s + (r - mean) ** 2, 0) / residuals.length);
    const rMin = Math.min(...residuals);
    const rMax = Math.max(...residuals);
    const rPad = (rMax - rMin) * 0.1 || 0.1;

    const grouped: Record<string, Array<{ x: number; y: number; partition: string }>> = {};
    for (const point of points) {
      if (!grouped[point.partition]) grouped[point.partition] = [];
      grouped[point.partition].push({ x: point.predicted, y: point.residual, partition: point.partition });
    }

    return {
      xDomain: [xMin - xPad, xMax + xPad] as [number, number],
      yDomain: [Math.min(rMin - rPad, -2 * std - rPad), Math.max(rMax + rPad, 2 * std + rPad)] as [number, number],
      stats: { mean, std, n: points.length },
      pointsByPartition: grouped,
    };
  }, [points]);

  const orderedPartitions = Object.keys(pointsByPartition).sort((a, b) => {
    const rank = (partition: string) => {
      if (partition === "train") return 0;
      if (partition === "val") return 1;
      if (partition === "test") return 2;
      return 3;
    };
    return rank(a) - rank(b);
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <TrendingDown className="h-4 w-4" /> Residuals
        </h4>
        <div className="flex items-center gap-2">
          {orderedPartitions.map((partition) => (
            <PartitionBadge key={partition} partition={partition} />
          ))}
          {foldId && <Badge variant="outline" className="text-[10px]">Fold {foldId}</Badge>}
        </div>
      </div>
      <div className="text-xs text-muted-foreground font-mono">
        Mean = {stats.mean.toFixed(4)} | Std = {stats.std.toFixed(4)} | n = {stats.n}
      </div>
      <div className="h-[350px]">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 10, bottom: 30, left: 40 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis type="number" dataKey="x" domain={xDomain} name="Predicted"
              label={{ value: "Predicted", position: "bottom", offset: 15, style: { fontSize: 12 } }}
              tick={{ fontSize: 10 }} />
            <YAxis type="number" dataKey="y" domain={yDomain} name="Residual"
              label={{ value: "Residual", angle: -90, position: "left", offset: 25, style: { fontSize: 12 } }}
              tick={{ fontSize: 10 }} />
            <RechartsTooltip
              content={({ payload }) => {
                if (!payload?.[0]) return null;
                const d = payload[0].payload;
                return (
                  <div className="bg-popover text-popover-foreground border rounded-md p-2 text-xs shadow-lg">
                    <div>Partition: {d.partition}</div>
                    <div>Predicted: {d.x?.toFixed(4)}</div>
                    <div>Residual: {d.y?.toFixed(4)}</div>
                    <div>Std Res: {(d.y / (stats.std || 1)).toFixed(2)}σ</div>
                  </div>
                );
              }}
            />
            {/* y=0 reference */}
            <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeWidth={1} />
            {/* ±2σ bands */}
            <ReferenceLine y={2 * stats.std} stroke="hsl(25, 95%, 53%)" strokeDasharray="4 4" strokeWidth={1} />
            <ReferenceLine y={-2 * stats.std} stroke="hsl(25, 95%, 53%)" strokeDasharray="4 4" strokeWidth={1} />
            {orderedPartitions.map((partition) => (
              <Scatter key={partition} data={pointsByPartition[partition]} isAnimationActive={false}>
                {pointsByPartition[partition].map((_, i) => (
                  <Cell key={`${partition}-${i}`} fill={PARTITION_COLORS[partition]?.dot || "#666"} fillOpacity={0.65} r={3} />
                ))}
              </Scatter>
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
