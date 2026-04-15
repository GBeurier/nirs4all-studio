import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  ChevronDown, ChevronRight, Database, Eye, ExternalLink, Loader2, TrendingDown, Trash2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { isClassificationTaskType, isLowerBetter } from "@/lib/scores";
import {
  deleteWorkspaceDatasetPredictions,
  getAllChainsForDataset,
  getAllChainsForResultsDataset,
} from "@/api/client";
import {
  formatPredictionDeletionSummary,
  invalidatePredictionRelatedQueries,
} from "@/lib/prediction-deletion";
import { datasetChainsToRows } from "@/lib/score-adapters";
import {
  InlineScoreDisplay,
  cardTypeColorClass,
} from "./ScoreColumns";
import { ScoreCardTree } from "./ScoreCardTree";
import { ModelDetailSheet, type ModelDetailSheetTab } from "@/components/runs/ModelDetailSheet";
import { PredictionQuickView } from "@/components/predictions/PredictionQuickView";
import type { TopChainResult, EnrichedDatasetRun, AllChainEntry } from "@/types/enriched-runs";
import type { PartitionPrediction } from "@/types/aggregated-predictions";
import type { ScoreCardRow } from "@/types/score-cards";
import type { ModelActionChartView } from "./ModelActionMenu";

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

function normalizeAllChainEntry(chain: AllChainEntry, runId?: string): TopChainResult {
  const displayParams = chain.variant_params ?? chain.best_params ?? null;
  return {
    chain_id: chain.chain_id,
    run_id: chain.run_id ?? runId,
    pipeline_id: chain.pipeline_id,
    pipeline_name: chain.pipeline_name,
    model_name: chain.model_name,
    model_class: chain.model_class,
    preprocessings: chain.preprocessings || "",
    avg_val_score: chain.cv_val_score,
    avg_test_score: chain.cv_test_score,
    avg_train_score: chain.cv_train_score,
    fold_count: chain.cv_fold_count,
    scores: {
      val: chain.cv_scores?.val ?? {},
      test: chain.cv_scores?.test ?? {},
    },
    cv_source_chain_id: chain.cv_source_chain_id ?? null,
    final_test_score: chain.final_test_score,
    final_train_score: chain.final_train_score,
    final_scores: (chain.final_scores as Record<string, unknown>) ?? {},
    final_agg_test_score: chain.final_agg_test_score ?? null,
    final_agg_train_score: chain.final_agg_train_score ?? null,
    final_agg_scores: (chain.final_agg_scores as Record<string, unknown>) ?? {},
    best_params: displayParams,
    variant_params: chain.variant_params ?? null,
    is_refit_only: chain.is_refit_only ?? (chain.final_test_score != null && chain.cv_fold_count <= 0 && chain.cv_val_score == null),
    synthetic_refit: chain.synthetic_refit ?? false,
  };
}

function hasBestParams(params: Record<string, unknown> | null | undefined): boolean {
  return !!params && Object.keys(params).length > 0;
}

// ============================================================================
// DatasetResultCard — main component
// ============================================================================

/**
 * DatasetResultCard — displays results for a single dataset in a hierarchical layout.
 *
 * Uses ScoreCardTree with the unified REFIT/CROSSVAL/TRAIN card hierarchy.
 *
 * Reused in both Results page and Runs page (RunItem).
 */
export function DatasetResultCard({
  dataset, allChains, selectedMetrics, runId, workspaceId, defaultExpanded = false,
}: DatasetResultCardProps) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [detailChain, setDetailChain] = useState<TopChainResult | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailInitialTab, setDetailInitialTab] = useState<ModelDetailSheetTab>("overview");
  const [detailInitialFoldId, setDetailInitialFoldId] = useState<string | null>(null);
  const [quickViewPred, setQuickViewPred] = useState<PartitionPrediction | null>(null);
  const [quickViewOpen, setQuickViewOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const useFullDatasetChains = !allChains && !!workspaceId;

  const { data: allChainsData, isLoading: isAllChainsLoading } = useQuery({
    queryKey: ["dataset-all-chains", workspaceId, runId ?? "__results__", dataset.dataset_name],
    queryFn: () => (
      runId
        ? getAllChainsForDataset(workspaceId!, runId, dataset.dataset_name)
        : getAllChainsForResultsDataset(workspaceId!, dataset.dataset_name)
    ),
    enabled: expanded && useFullDatasetChains,
    staleTime: 60000,
  });

  const chains = useMemo(() => {
    if (allChains) return allChains;
    if (useFullDatasetChains) {
      if (allChainsData?.chains) {
        return allChainsData.chains.map(chain => normalizeAllChainEntry(chain, runId));
      }
    }
    return dataset.top_5;
  }, [allChains, allChainsData, dataset.top_5, runId, useFullDatasetChains]);

  // Convert chains to unified ScoreCardRows
  const scoreRows = useMemo(() => {
    return datasetChainsToRows(chains, dataset.metric, dataset.task_type);
  }, [chains, dataset.metric, dataset.task_type]);

  const primaryRows = useMemo(
    () => scoreRows.filter((row) => row.foldId !== "final_agg"),
    [scoreRows],
  );
  const summaryRows = primaryRows.length > 0 ? primaryRows : scoreRows;

  const handleViewDetails = (row: ScoreCardRow) => {
    const chain = chains.find(c => c.chain_id === row.chainId);
    if (chain) {
      setDetailInitialTab("overview");
      setDetailInitialFoldId(row.foldId ?? null);
      setDetailChain(
        hasBestParams(chain.best_params) || !hasBestParams(row.bestParams)
          ? chain
          : { ...chain, best_params: row.bestParams },
      );
      setDetailOpen(true);
    }
  };

  const handleOpenChart = (row: ScoreCardRow, view: ModelActionChartView) => {
    const chain = chains.find(c => c.chain_id === row.chainId);
    if (!chain) return;
    setDetailInitialTab(view);
    setDetailInitialFoldId(row.foldId ?? null);
    setDetailChain(
      hasBestParams(chain.best_params) || !hasBestParams(row.bestParams)
        ? chain
        : { ...chain, best_params: row.bestParams },
    );
    setDetailOpen(true);
  };

  const handleViewPrediction = (_predictionId: string, prediction?: PartitionPrediction) => {
    if (prediction) {
      setQuickViewPred(prediction);
      setQuickViewOpen(true);
    }
  };

  // Best row for header summary
  const bestRow = summaryRows[0];
  const bestContext = bestRow?.cardType === "refit" ? "refit" as const : "crossval" as const;
  const bestSummaryLabel = bestContext === "refit" ? "Best Refit" : "Best CV";

  const topRefitRow = summaryRows.find(row => row.cardType === "refit");
  const pairedCvRow = topRefitRow?.children?.find(child => child.cardType === "crossval");
  const delta = topRefitRow?.primaryTestScore != null && pairedCvRow?.primaryValScore != null
    ? (isLowerBetter(dataset.metric)
      ? pairedCvRow.primaryValScore - topRefitRow.primaryTestScore
      : topRefitRow.primaryTestScore - pairedCvRow.primaryValScore)
    : null;

  const topChain = bestRow ? chains.find(chain => chain.chain_id === bestRow.chainId) ?? null : null;
  const refitCount = summaryRows.filter(row => row.cardType === "refit").length;

  const handleDeleteDataset = async () => {
    if (!workspaceId) {
      toast.error("No active workspace");
      return;
    }

    setDeleteBusy(true);
    try {
      const result = await deleteWorkspaceDatasetPredictions(workspaceId, dataset.dataset_name);
      if (!result.success) {
        toast.error("Nothing was deleted");
        return;
      }

      await invalidatePredictionRelatedQueries(queryClient);
      setDeleteOpen(false);
      toast.success(formatPredictionDeletionSummary(result));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Dataset deletion failed");
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <>
      <Card className="overflow-hidden">
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleTrigger asChild>
            <CardHeader className="p-3 cursor-pointer hover:bg-muted/30 transition-colors">
              <div className="flex items-center gap-3 lg:grid lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)_auto] lg:items-center">
                <div className="flex items-center gap-2 min-w-0">
                  {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                  <div className="p-1.5 rounded-md bg-primary/10">
                    <Database className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-sm text-foreground">{dataset.dataset_name}</h3>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                      {dataset.task_type && <span className="capitalize">{dataset.task_type}</span>}
                      {refitCount > 0 && (
                        <Badge variant="secondary" className="text-[9px] h-4 px-1 bg-emerald-500/10 text-emerald-600">
                          {refitCount} refit
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>

                <div className="hidden min-w-0 md:flex lg:justify-self-stretch">
                  {bestRow && (
                    <div className="flex min-w-0 items-center gap-2 lg:grid lg:grid-cols-[minmax(0,6rem)_minmax(0,1fr)_minmax(0,7rem)] lg:items-center">
                      <div className="min-w-0 shrink-0">
                        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          {bestSummaryLabel}
                        </div>
                        {delta != null && delta > 0 && (
                          <Badge variant="outline" className="mt-1 h-4 gap-0.5 px-1 text-[9px] text-emerald-500 border-emerald-500/20">
                            <TrendingDown className="h-2.5 w-2.5" />
                            {isLowerBetter(dataset.metric) ? "↓" : "↑"}{Math.abs(delta).toFixed(4)}
                          </Badge>
                        )}
                      </div>
                      <InlineScoreDisplay
                        row={bestRow}
                        selectedMetrics={selectedMetrics}
                        colorClass={cardTypeColorClass(bestContext)}
                      />
                      <span className="truncate text-right text-[9px] text-muted-foreground font-mono" title={bestRow.preprocessings || ""}>
                        {bestRow.modelName}
                      </span>
                    </div>
                  )}
                </div>

                <div className="ml-auto flex items-center gap-1 shrink-0 lg:ml-0 lg:justify-self-end">
                  {workspaceId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteOpen(true);
                      }}
                      title="Delete all predictions for this dataset"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {topChain && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs gap-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDetailInitialTab("overview");
                        setDetailInitialFoldId(bestRow?.foldId ?? null);
                        setDetailChain(topChain);
                        setDetailOpen(true);
                      }}
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
            <CardContent className="px-3 pb-3 pt-0">
              {expanded && useFullDatasetChains && isAllChainsLoading && (
                <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading full model history...
                </div>
              )}
              <ScoreCardTree
                rows={scoreRows}
                selectedMetrics={selectedMetrics}
                workspaceId={workspaceId}
                variant="card"
                onViewDetails={handleViewDetails}
                onViewPrediction={handleViewPrediction}
                onOpenChart={handleOpenChart}
                showNonRefitSection
                startCollapsed={!defaultExpanded}
              />
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <ModelDetailSheet
        chain={detailChain}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        initialTab={detailInitialTab}
        initialFoldId={detailInitialFoldId}
        taskType={dataset.task_type}
        datasetName={dataset.dataset_name}
      />

      <PredictionQuickView
        partitionPrediction={quickViewPred}
        open={quickViewOpen}
        onOpenChange={setQuickViewOpen}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete dataset predictions?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes all stored predictions for {dataset.dataset_name} in the active workspace. Empty chains, pipelines, arrays, and orphaned artifacts will be cleaned automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteDataset} disabled={deleteBusy}>
              {deleteBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Delete predictions
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
