import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  ChevronDown, ChevronRight, Database, Eye, ExternalLink,
  TrendingDown, Loader2, Star,
} from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { formatMetricValue, isLowerBetter, getMetricAbbreviation, extractScoreValue } from "@/lib/scores";
import { getChainPartitionDetail } from "@/api/client";
import { AllModelsPanel } from "@/components/runs/AllModelsPanel";
import { ModelDetailSheet } from "@/components/runs/ModelDetailSheet";
import type { TopChainResult, EnrichedDatasetRun } from "@/types/enriched-runs";
import type { PartitionPrediction } from "@/types/aggregated-predictions";

// ============================================================================
// Props
// ============================================================================

interface DatasetResultCardProps {
  dataset: EnrichedDatasetRun;
  allChains?: TopChainResult[];
  selectedMetrics: string[];
  runId?: string;
  workspaceId?: string;
  defaultExpanded?: boolean;
}

// ============================================================================
// InlineMetrics — row of metric label/value pairs
// ============================================================================

type ScoreContext = "final" | "cv" | "fold";

/** Get the display label for a metric key based on context (final → RMSEP, cv → RMSECV, etc.) */
function getContextLabel(key: string, context: ScoreContext, primaryMetric: string | null): string {
  const k = key.toLowerCase();
  const pm = (primaryMetric || "").toLowerCase();
  // For the primary error metric, use NIRS naming
  if ((k === "rmse" || k === pm) && isLowerBetter(key)) {
    if (context === "final") return "RMSEP";
    if (context === "cv") return "RMSECV";
  }
  return getMetricAbbreviation(key);
}

function InlineMetrics({
  scores,
  selectedMetrics,
  metric,
  colorClass,
  context = "cv",
}: {
  scores: Record<string, number | null | undefined>;
  selectedMetrics: string[];
  metric: string | null;
  colorClass?: string;
  context?: ScoreContext;
}) {
  return (
    <div className="flex items-center gap-2.5 flex-wrap">
      {selectedMetrics.map(k => {
        const raw = scores[k];
        const val = raw != null ? (typeof raw === "number" ? raw : typeof raw === "string" ? parseFloat(raw as unknown as string) : null) : null;
        const safeVal = val != null && Number.isFinite(val) ? val : null;
        return (
          <span key={k} className="inline-flex items-center gap-0.5 text-[11px]">
            <span className="text-muted-foreground uppercase text-[9px] font-medium">{getContextLabel(k, context, metric)}</span>
            <span className={cn("font-mono font-semibold tabular-nums", colorClass || "text-foreground/80")}>
              {safeVal != null ? formatMetricValue(safeVal, k) : "—"}
            </span>
          </span>
        );
      })}
    </div>
  );
}

// ============================================================================
// extractChainScores — build a flat scores map from a chain for InlineMetrics
// ============================================================================

/** Extract the best available scores for display on a chain's header row.
 *  For refit models: final_scores → final_test_score scalar → CV val → CV test.
 *  For CV-only models: CV val → CV test → avg scalars. */
function extractChainScores(chain: TopChainResult, selectedMetrics: string[], primaryMetric: string | null = null): Record<string, number | null> {
  const hasFinal = chain.final_test_score != null;
  const result: Record<string, number | null> = {};
  const pm = (primaryMetric || "rmse").toLowerCase();

  for (const k of selectedMetrics) {
    const kl = k.toLowerCase();
    let val: number | null = null;

    if (hasFinal) {
      // 1. Try from final_scores dict (flat or nested)
      val = extractScoreValue(chain.final_scores, k, "test");
      // 2. Fallback: if this is the primary metric, use the scalar
      if (val == null && (kl === pm || kl === "rmse")) {
        val = safeNumber(chain.final_test_score);
      }
    }
    // 3. CV val scores
    if (val == null) val = safeNumber(chain.scores?.val?.[k]);
    // 4. CV test scores
    if (val == null) val = safeNumber(chain.scores?.test?.[k]);
    // 5. Scalar fallbacks for primary metric
    if (val == null && (kl === pm || kl === "rmse")) {
      val = safeNumber(chain.avg_val_score) ?? safeNumber(chain.avg_test_score);
    }
    result[k] = val;
  }
  return result;
}

/** Coerce a value to a finite number or null. */
function safeNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

// ============================================================================
// FoldDetailRows — inline fold-level scores for an expanded model
// ============================================================================

function FoldDetailRows({
  chainId,
  selectedMetrics,
  metric,
  onViewDetails,
  excludeFinal = false,
}: {
  chainId: string;
  selectedMetrics: string[];
  metric: string | null;
  onViewDetails?: () => void;
  excludeFinal?: boolean;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["chain-partition-detail", chainId],
    queryFn: () => getChainPartitionDetail(chainId),
    staleTime: 60000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-2 pl-8 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading fold details...
      </div>
    );
  }

  const predictions = data?.predictions || [];
  if (predictions.length === 0) {
    return <div className="text-xs text-muted-foreground pl-8 py-1">No fold data available</div>;
  }

  // Group: avg, w_avg, then numbered folds (val partition only for summary rows)
  const FOLD_ORDER: Record<string, number> = { final: 0, avg: 1, w_avg: 2 };
  const sorted = [...predictions].sort((a, b) => {
    const aO = FOLD_ORDER[a.fold_id] ?? (100 + parseInt(a.fold_id || "999"));
    const bO = FOLD_ORDER[b.fold_id] ?? (100 + parseInt(b.fold_id || "999"));
    if (aO !== bO) return aO - bO;
    const partOrder = ["val", "test", "train"];
    return partOrder.indexOf(a.partition) - partOrder.indexOf(b.partition);
  });

  // Deduplicate: show one row per fold (prefer val partition for display)
  const foldMap = new Map<string, PartitionPrediction>();
  for (const pred of sorted) {
    // Skip final fold if requested (refit models show final on the header row)
    if (excludeFinal && pred.fold_id === "final") continue;
    if (!foldMap.has(pred.fold_id) || pred.partition === "val") {
      foldMap.set(pred.fold_id, pred);
    }
  }
  const foldRows = Array.from(foldMap.values());

  function foldLabel(foldId: string): string {
    if (foldId === "final") return "Final (refit)";
    if (foldId === "avg") return "Average folds";
    if (foldId === "w_avg") return "Weighted Avg folds";
    return `Fold ${foldId}`;
  }

  function foldColorClass(foldId: string): string {
    if (foldId === "final") return "text-emerald-500";
    if (foldId === "avg" || foldId === "w_avg") return "text-chart-1";
    return "text-foreground/70";
  }

  function predictionScores(pred: PartitionPrediction): Record<string, number | null> {
    const result: Record<string, number | null> = {};
    const pm = (metric || "rmse").toLowerCase();
    const scoresObj = pred.scores as Record<string, unknown> | null | undefined;
    for (const k of selectedMetrics) {
      const kl = k.toLowerCase();
      let val: number | null = null;
      if (scoresObj && typeof scoresObj === "object") {
        // 1. Try flat: scores[k]
        val = safeNumber(scoresObj[k]);
        // 2. Try nested partition-keyed: scores[partition][k]
        if (val == null) {
          for (const part of [pred.partition, "val", "test", "train"]) {
            const inner = scoresObj[part];
            if (inner && typeof inner === "object") {
              val = safeNumber((inner as Record<string, unknown>)[k]);
              if (val != null) break;
            }
          }
        }
      }
      // 3. Scalar fallback for primary metric
      if (val == null && (kl === pm || kl === "rmse")) {
        val = safeNumber(pred.val_score) ?? safeNumber(pred.test_score) ?? safeNumber(pred.train_score);
      }
      result[k] = val;
    }
    return result;
  }

  return (
    <div className="space-y-0.5 pl-6 border-l-2 border-border/40 ml-3">
      {foldRows.map(pred => {
        const isFinal = pred.fold_id === "final";
        const isAgg = pred.fold_id === "avg" || pred.fold_id === "w_avg";
        return (
          <div
            key={pred.prediction_id}
            className={cn(
              "flex items-center justify-between py-1 px-2 rounded text-xs",
              isFinal && "bg-emerald-500/5",
              isAgg && "bg-muted/30",
            )}
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className={cn("text-[11px] font-medium min-w-[110px] shrink-0", foldColorClass(pred.fold_id))}>
                {foldLabel(pred.fold_id)}
              </span>
              <InlineMetrics
                scores={predictionScores(pred)}
                selectedMetrics={selectedMetrics}
                metric={metric}
                colorClass={foldColorClass(pred.fold_id)}
                context={isFinal ? "final" : "fold"}
              />
            </div>
            {onViewDetails && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 shrink-0"
                onClick={onViewDetails}
                title="View details"
              >
                <Eye className="h-3 w-3" />
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// ModelCollapsibleRow — single model with collapsible fold details
// ============================================================================

/** Extract CV scores from a chain (scores.val → scores.test → scalar fallbacks). */
function extractCvScores(chain: TopChainResult, selectedMetrics: string[], primaryMetric: string | null): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  const pm = (primaryMetric || "rmse").toLowerCase();
  for (const k of selectedMetrics) {
    const kl = k.toLowerCase();
    let val = safeNumber(chain.scores?.val?.[k]);
    if (val == null) val = safeNumber(chain.scores?.test?.[k]);
    // Scalar fallbacks for primary metric
    if (val == null && (kl === pm || kl === "rmse")) {
      val = safeNumber(chain.avg_val_score) ?? safeNumber(chain.avg_test_score);
    }
    result[k] = val;
  }
  return result;
}

function ModelCollapsibleRow({
  chain,
  rank,
  metric,
  taskType,
  selectedMetrics,
  onViewDetails,
  displayContext,
}: {
  chain: TopChainResult;
  rank: number;
  metric: string | null;
  taskType: string | null;
  selectedMetrics: string[];
  onViewDetails: () => void;
  /** "final" = show refit scores on header, "cv" = show CV scores on header */
  displayContext?: "final" | "cv";
}) {
  const [expanded, setExpanded] = useState(false);
  const hasFinal = chain.final_test_score != null;
  const finalScores = hasFinal ? extractChainScores(chain, selectedMetrics, metric) : null;
  const cvScores = extractCvScores(chain, selectedMetrics, metric);
  const hasCvData = Object.values(cvScores).some(v => v != null);
  // Determine what to show on the header row
  const showFinalOnHeader = displayContext === "final" || (displayContext == null && hasFinal);

  const chainLabel = [chain.preprocessings, chain.best_params ? formatBestParams(chain.best_params) : null]
    .filter(Boolean).join(" | ");

  return (
    <div className={cn("rounded-md border", showFinalOnHeader ? "border-emerald-500/20" : "border-border/50")}>
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <div className="flex items-center gap-1">
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-2 flex-1 min-w-0 py-1.5 px-2 text-left hover:bg-muted/30 rounded-l-md transition-colors">
              {expanded
                ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
              }
              <Star className={cn("h-3 w-3 shrink-0", showFinalOnHeader ? "text-emerald-500 fill-emerald-500" : "text-chart-1 fill-chart-1")} />
              <span className="text-xs font-semibold shrink-0">
                #{rank}
              </span>
              <Badge variant="outline" className={cn("text-[10px] font-mono shrink-0", showFinalOnHeader && "border-emerald-500/30 text-emerald-600 dark:text-emerald-400")}>
                {chain.model_name}
              </Badge>
              {chainLabel && (
                <span className="text-[10px] text-muted-foreground truncate" title={chainLabel}>
                  {chainLabel}
                </span>
              )}
            </button>
          </CollapsibleTrigger>

          <div className="flex items-center gap-2 pr-2 shrink-0">
            <InlineMetrics
              scores={showFinalOnHeader ? (finalScores || cvScores) : cvScores}
              selectedMetrics={selectedMetrics}
              metric={metric}
              colorClass={showFinalOnHeader ? "text-emerald-500" : "text-chart-1"}
              context={showFinalOnHeader ? "final" : "cv"}
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={(e) => { e.stopPropagation(); onViewDetails(); }}
              title="View details"
            >
              <Eye className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <CollapsibleContent>
          <div className="px-2 pb-2 space-y-2">
            {/* For refit display: show origin CV scores inline if available */}
            {showFinalOnHeader && hasCvData && (
              <div className="flex items-center justify-between py-1 px-2 rounded bg-chart-1/5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="text-[11px] font-medium min-w-[90px] shrink-0 text-chart-1">
                    Origin CV
                  </span>
                  <InlineMetrics
                    scores={cvScores}
                    selectedMetrics={selectedMetrics}
                    metric={metric}
                    colorClass="text-chart-1"
                    context="cv"
                  />
                </div>
                <Button variant="ghost" size="sm" className="h-5 w-5 p-0 shrink-0" onClick={onViewDetails} title="View details">
                  <Eye className="h-3 w-3" />
                </Button>
              </div>
            )}

            {/* Per-fold details */}
            <FoldDetailRows
              chainId={chain.chain_id}
              selectedMetrics={selectedMetrics}
              metric={metric}
              onViewDetails={onViewDetails}
              excludeFinal={showFinalOnHeader}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function formatBestParams(params: Record<string, unknown> | null | undefined): string | null {
  if (!params || Object.keys(params).length === 0) return null;
  return Object.entries(params)
    .map(([k, v]) => `${k}=${typeof v === "number" ? (Number.isInteger(v) ? v : (v as number).toPrecision(4)) : String(v)}`)
    .join(", ");
}

// ============================================================================
// DatasetResultCard — main component
// ============================================================================

/**
 * DatasetResultCard — displays results for a single dataset in a hierarchical layout.
 *
 * Hierarchy: Dataset (collapsible) → Model rows (collapsible) → Fold detail rows.
 * Includes an "Inspect all models" section (AllModelsPanel) at the bottom.
 * Details buttons open ModelDetailSheet side-sheet.
 *
 * Reused in both Results page and Runs page (RunItem).
 */
export function DatasetResultCard({
  dataset, allChains, selectedMetrics, runId, workspaceId, defaultExpanded = false,
}: DatasetResultCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [detailChain, setDetailChain] = useState<TopChainResult | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const chains = allChains || dataset.top_5;

  // Unified list: refit models first (sorted by final score), then CV models (sorted by val score)
  // A chain with both refit AND CV data appears in BOTH sections (once as refit, once as CV).
  const { refitChains, cvChains, refitCount } = useMemo(() => {
    const lowerBetter = isLowerBetter(dataset.metric);
    const refit = chains
      .filter(c => c.final_test_score != null)
      .sort((a, b) => {
        const aS = a.final_test_score ?? (lowerBetter ? Infinity : -Infinity);
        const bS = b.final_test_score ?? (lowerBetter ? Infinity : -Infinity);
        return lowerBetter ? aS - bS : bS - aS;
      });
    // CV section: all chains that have CV data (avg_val_score), sorted by val score
    const cv = chains
      .filter(c => c.avg_val_score != null)
      .sort((a, b) => {
        const aS = a.avg_val_score ?? (lowerBetter ? Infinity : -Infinity);
        const bS = b.avg_val_score ?? (lowerBetter ? Infinity : -Infinity);
        return lowerBetter ? aS - bS : bS - aS;
      });
    return { refitChains: refit, cvChains: cv, refitCount: refit.length };
  }, [chains, dataset.metric]);

  const bestFinalScore = dataset.best_final_score;
  const hasFinal = bestFinalScore != null;

  // Best chain for the header inline scores
  const bestChain = refitChains[0] || cvChains[0];
  const bestScores = bestChain ? extractChainScores(bestChain, selectedMetrics, dataset.metric) : {};
  const bestContext: ScoreContext = hasFinal ? "final" : "cv";
  const bestSummaryLabel = hasFinal
    ? `Best Refit ${getContextLabel(dataset.metric || "score", "final", dataset.metric)}`
    : `Best CV ${getContextLabel(dataset.metric || "score", "cv", dataset.metric)}`;

  // Delta between final and CV for the top model
  const topChain = refitChains[0] || cvChains[0];
  const delta = topChain && topChain.final_test_score != null && topChain.avg_val_score != null
    ? (isLowerBetter(dataset.metric)
      ? topChain.avg_val_score - topChain.final_test_score
      : topChain.final_test_score - topChain.avg_val_score)
    : null;

  const openDetailFor = (chain: TopChainResult) => {
    setDetailChain(chain);
    setDetailOpen(true);
  };

  return (
    <>
      <Card className="overflow-hidden">
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleTrigger asChild>
            <CardHeader className="p-3 cursor-pointer hover:bg-muted/30 transition-colors">
              <div className="flex items-center gap-3">
                {/* Left: chevron + icon + name */}
                <div className="flex items-center gap-2 min-w-0 shrink-0">
                  {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                  <div className="p-1.5 rounded-md bg-primary/10">
                    <Database className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-sm text-foreground">{dataset.dataset_name}</h3>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                      {dataset.task_type && <span className="capitalize">{dataset.task_type}</span>}
                      {dataset.metric && <><span>·</span><span>{dataset.metric.toUpperCase()}</span></>}
                      <span>·</span>
                      <span>{chains.length} models</span>
                      {refitCount > 0 && (
                        <Badge variant="secondary" className="text-[9px] h-4 px-1 bg-emerald-500/10 text-emerald-600">
                          {refitCount} refit
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>

                {/* Center: inline scores for best model */}
                <div className="flex-1 min-w-0 hidden md:flex items-center justify-center">
                  {bestChain && (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {bestSummaryLabel}
                      </span>
                      {delta != null && delta > 0 && (
                        <Badge variant="outline" className="text-[9px] text-emerald-500 border-emerald-500/20 gap-0.5">
                          <TrendingDown className="h-2.5 w-2.5" />
                          {isLowerBetter(dataset.metric) ? "↓" : "↑"}{Math.abs(delta).toFixed(4)}
                        </Badge>
                      )}
                      <InlineMetrics
                        scores={bestScores}
                        selectedMetrics={selectedMetrics}
                        metric={dataset.metric}
                        colorClass={hasFinal ? "text-emerald-500" : "text-chart-1"}
                        context={bestContext}
                      />
                      <span className="text-[9px] text-muted-foreground font-mono truncate max-w-[120px]" title={bestChain.preprocessings}>
                        {bestChain.model_name}
                      </span>
                    </div>
                  )}
                </div>

                {/* Right: details + link */}
                <div className="flex items-center gap-1 shrink-0">
                  {bestChain && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs gap-1"
                      onClick={(e) => { e.stopPropagation(); openDetailFor(bestChain); }}
                    >
                      <Eye className="h-3 w-3" /> details
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="text-xs h-6" asChild onClick={(e) => e.stopPropagation()}>
                    <Link to={`/datasets/${encodeURIComponent(dataset.dataset_name)}`}>
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </Button>
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <CardContent className="px-3 pb-3 pt-0 space-y-3">
              {/* Refit models (sorted by RMSEP) */}
              {refitChains.length > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className="font-medium uppercase tracking-wide text-emerald-600">Refit models</span>
                    <div className="flex-1 border-t border-emerald-500/20" />
                  </div>
                  {refitChains.map((chain, idx) => (
                    <ModelCollapsibleRow
                      key={`refit-${chain.chain_id}`}
                      chain={chain}
                      rank={idx + 1}
                      metric={dataset.metric}
                      taskType={dataset.task_type}
                      selectedMetrics={selectedMetrics}
                      onViewDetails={() => openDetailFor(chain)}
                      displayContext="final"
                    />
                  ))}
                </div>
              )}

              {/* CV models (sorted by validation score) */}
              {cvChains.length > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className="font-medium uppercase tracking-wide">CV models (by validation score)</span>
                    <div className="flex-1 border-t border-border/40" />
                  </div>
                  {cvChains.map((chain, idx) => (
                    <ModelCollapsibleRow
                      key={`cv-${chain.chain_id}`}
                      chain={chain}
                      rank={refitChains.length + idx + 1}
                      metric={dataset.metric}
                      taskType={dataset.task_type}
                      selectedMetrics={selectedMetrics}
                      onViewDetails={() => openDetailFor(chain)}
                      displayContext="cv"
                    />
                  ))}
                </div>
              )}

              {/* Inspect all models (lazy-loaded AllModelsPanel) */}
              {workspaceId && runId && (
                <AllModelsPanel
                  workspaceId={workspaceId}
                  runId={runId}
                  datasetName={dataset.dataset_name}
                  taskType={dataset.task_type}
                  totalPipelines={dataset.pipeline_count}
                />
              )}

              {/* Empty state */}
              {chains.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-4">
                  No scored models available
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <ModelDetailSheet
        chain={detailChain}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        taskType={dataset.task_type}
        datasetName={dataset.dataset_name}
      />
    </>
  );
}
