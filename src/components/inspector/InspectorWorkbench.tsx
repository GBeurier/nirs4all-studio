import { useMemo, useState } from "react";

import { ArrowUpRight, FilterX, RefreshCw, SlidersHorizontal, Sparkles, Target } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, ErrorState, InlineError, LoadingState } from "@/components/ui/state-display";
import { useInspectorData } from "@/context/InspectorDataContext";
import { useInspectorFilter } from "@/context/InspectorFilterContext";
import { useInspectorSelection } from "@/context/InspectorSelectionContext";
import {
  useInspectorBiasVariance,
  useInspectorConfusionMatrix,
  useInspectorFoldStability,
  useInspectorScatter,
} from "@/hooks/useInspectorData";
import {
  buildCandlestickData,
  buildHeatmapData,
  buildHistogramData,
  buildHyperparameterData,
  buildOverviewData,
  buildPreprocessingImpactData,
  buildRankingsData,
  formatScopeLabel,
  getAvailableHyperparameters,
  normalizeTaskType,
  selectTopChains,
} from "@/lib/inspector/derived";
import { cn } from "@/lib/utils";
import { formatMetricValue, getMetricAbbreviation } from "@/lib/scores";
import { SCORE_COLUMNS } from "@/types/inspector";
import type { InspectorGroup, ScoreColumn } from "@/types/inspector";
import { InspectorGroupedLeaderboard } from "./InspectorGroupedLeaderboard";
import { InspectorSectionCard } from "./InspectorSectionCard";
import { InspectorSummaryStrip } from "./InspectorSummaryStrip";
import { CandlestickChart } from "./visualizations/CandlestickChart";
import { ConfusionMatrixChart } from "./visualizations/ConfusionMatrixChart";
import { FoldStabilityChart } from "./visualizations/FoldStabilityChart";
import { HyperparameterSensitivity } from "./visualizations/HyperparameterSensitivity";
import { PerformanceHeatmap } from "./visualizations/PerformanceHeatmap";
import { PredVsObsChart } from "./visualizations/PredVsObsChart";
import { PreprocessingImpact } from "./visualizations/PreprocessingImpact";
import { RankingsTable } from "./visualizations/RankingsTable";
import { ResidualsChart } from "./visualizations/ResidualsChart";
import { ScoreHistogram } from "./visualizations/ScoreHistogram";
import { BiasVariance } from "./visualizations/BiasVariance";

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "detail" in error) {
    const detail = (error as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) return detail;
  }
  return fallback;
}

function intersectGroups(groups: InspectorGroup[], visibleIds: Set<string>): InspectorGroup[] {
  return groups
    .map(group => ({
      ...group,
      chain_ids: group.chain_ids.filter(chainId => visibleIds.has(chainId)),
    }))
    .filter(group => group.chain_ids.length > 0);
}

export function InspectorWorkbench() {
  const {
    chains,
    groups,
    isLoading,
    error,
    refresh,
    scoreColumn,
    setScoreColumn,
    partition,
    setPartition,
    totalChains,
  } = useInspectorData();
  const {
    filteredChains,
    filteredChainIds,
    activeFilterCount,
    clearAllFilters,
    hasActiveFilters,
  } = useInspectorFilter();
  const { selectedChains, selectedCount, clear: clearSelection } = useInspectorSelection();
  const [selectedHyperParam, setSelectedHyperParam] = useState("");

  const visibleChains = filteredChains;
  const activeGroups = useMemo(
    () => intersectGroups(groups, filteredChainIds),
    [filteredChainIds, groups],
  );
  const overview = useMemo(
    () => buildOverviewData(visibleChains, scoreColumn),
    [scoreColumn, visibleChains],
  );

  const rankingsData = useMemo(
    () => buildRankingsData(visibleChains, scoreColumn),
    [scoreColumn, visibleChains],
  );
  const histogramData = useMemo(
    () => buildHistogramData(visibleChains, scoreColumn),
    [scoreColumn, visibleChains],
  );
  const heatmapData = useMemo(
    () => buildHeatmapData(visibleChains, scoreColumn),
    [scoreColumn, visibleChains],
  );
  const candlestickData = useMemo(
    () => buildCandlestickData(visibleChains, scoreColumn),
    [scoreColumn, visibleChains],
  );
  const preprocessingImpactData = useMemo(
    () => buildPreprocessingImpactData(visibleChains, scoreColumn),
    [scoreColumn, visibleChains],
  );
  const availableHyperParams = useMemo(
    () => getAvailableHyperparameters(visibleChains),
    [visibleChains],
  );
  const activeHyperParam = useMemo(() => {
    if (selectedHyperParam && availableHyperParams.includes(selectedHyperParam)) {
      return selectedHyperParam;
    }
    return availableHyperParams[0] ?? "";
  }, [availableHyperParams, selectedHyperParam]);
  const hyperparameterData = useMemo(
    () => buildHyperparameterData(visibleChains, activeHyperParam, scoreColumn),
    [activeHyperParam, scoreColumn, visibleChains],
  );

  const topChains = useMemo(
    () => selectTopChains(visibleChains, scoreColumn, 6),
    [scoreColumn, visibleChains],
  );
  const selectedVisibleIds = useMemo(
    () => Array.from(selectedChains).filter(chainId => filteredChainIds.has(chainId)),
    [filteredChainIds, selectedChains],
  );
  const diagnosticsChains = useMemo(() => {
    if (selectedVisibleIds.length > 0) {
      const selectedIdSet = new Set(selectedVisibleIds);
      return visibleChains.filter(chain => selectedIdSet.has(chain.chain_id));
    }
    return topChains;
  }, [selectedVisibleIds, topChains, visibleChains]);
  const diagnosticsChainIds = diagnosticsChains.map(chain => chain.chain_id);
  const diagnosticsTaskKinds = [...new Set(diagnosticsChains.map(chain => normalizeTaskType(chain.task_type)))];
  const diagnosticsScope = selectedVisibleIds.length > 0
    ? `${selectedVisibleIds.length} selected chain${selectedVisibleIds.length > 1 ? "s" : ""}`
    : `top ${diagnosticsChains.length} ranked chains`;

  const scatterQuery = useInspectorScatter(
    diagnosticsTaskKinds.length === 1 && diagnosticsTaskKinds[0] === "regression" && diagnosticsChainIds.length > 0
      ? { chain_ids: diagnosticsChainIds, partition }
      : null,
  );
  const confusionQuery = useInspectorConfusionMatrix(
    diagnosticsTaskKinds.length === 1 && diagnosticsTaskKinds[0] === "classification" && diagnosticsChainIds.length > 0
      ? { chain_ids: diagnosticsChainIds, partition }
      : null,
  );
  const biasVarianceQuery = useInspectorBiasVariance(
    diagnosticsTaskKinds.length === 1 && diagnosticsTaskKinds[0] === "regression" && diagnosticsChainIds.length > 0
      ? { chain_ids: diagnosticsChainIds, score_column: scoreColumn }
      : null,
  );
  const foldStabilityQuery = useInspectorFoldStability(
    diagnosticsTaskKinds.length === 1 && diagnosticsTaskKinds[0] === "regression" && diagnosticsChainIds.length > 0
      ? { chain_ids: diagnosticsChainIds, score_column: scoreColumn, partition }
      : null,
  );

  const scopeLabel = formatScopeLabel(overview.taskKinds);
  const metricLabel = getMetricAbbreviation(overview.metric ?? scoreColumn);
  const mixedComparisonScope = overview.taskKinds.length > 1 || overview.metrics.length > 1;

  if (isLoading && chains.length === 0) {
    return <LoadingState message="Loading predictions inspector..." className="min-h-[480px]" />;
  }

  if (error && chains.length === 0) {
    return (
      <ErrorState
        title="Inspector unavailable"
        message={error}
        onRetry={refresh}
        retryLabel="Reload inspector"
      />
    );
  }

  if (chains.length === 0) {
    return (
      <EmptyState
        icon={Target}
        title="No predictions to inspect"
        description="Run or import predictions first, then use the inspector to compare models, preprocessings, score distributions, and diagnostics."
        action={{ label: "Refresh", onClick: refresh }}
      />
    );
  }

  if (visibleChains.length === 0) {
    return (
      <EmptyState
        icon={FilterX}
        title="No chains match the current filters"
        description="Your source filters still have data, but the local score, outlier, or selection filters removed every chain from view."
        action={{ label: "Clear local filters", onClick: clearAllFilters }}
        secondaryAction={{ label: "Refresh", onClick: refresh }}
      />
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-background">
      <div className="space-y-4 p-4 md:p-5">
        <Card className="border-border/60 bg-gradient-to-br from-slate-50 via-white to-emerald-50 shadow-sm dark:from-slate-950 dark:via-slate-950 dark:to-emerald-950/30">
          <CardContent className="space-y-4 p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="bg-background/70">
                    Inspector
                  </Badge>
                  <Badge variant="secondary" className="bg-background/70">
                    {scopeLabel}
                  </Badge>
                  {mixedComparisonScope ? (
                    <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                      mixed scope
                    </Badge>
                  ) : null}
                </div>
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-foreground">Prediction landscape</h1>
                  <p className="max-w-3xl text-sm text-muted-foreground">
                    Use this page to understand which model families, preprocessing strategies, and individual chains are driving performance.
                    The global sections summarize the current scope; the diagnostics section below drills into {diagnosticsScope}.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{visibleChains.length} chains in view</span>
                  <span className="text-border">•</span>
                  <span>{metricLabel} on {partition}</span>
                  <span className="text-border">•</span>
                  <span>{overview.lowerIsBetter ? "lower values rank first" : "higher values rank first"}</span>
                  {activeFilterCount > 0 ? (
                    <>
                      <span className="text-border">•</span>
                      <span>{activeFilterCount} local filter{activeFilterCount > 1 ? "s" : ""} active</span>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 xl:w-[360px]">
                <Select value={scoreColumn} onValueChange={value => setScoreColumn(value as ScoreColumn)}>
                  <SelectTrigger className="h-9 bg-background/80 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCORE_COLUMNS.map(column => (
                      <SelectItem key={column.value} value={column.value}>
                        {column.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={partition} onValueChange={setPartition}>
                  <SelectTrigger className="h-9 bg-background/80 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="val">Validation</SelectItem>
                    <SelectItem value="test">Test</SelectItem>
                    <SelectItem value="train">Train</SelectItem>
                  </SelectContent>
                </Select>

                <Button variant="outline" className="h-9 justify-start gap-2 bg-background/80 text-xs" onClick={refresh}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh
                </Button>

                <Button
                  variant="outline"
                  className="h-9 justify-start gap-2 bg-background/80 text-xs"
                  onClick={hasActiveFilters ? clearAllFilters : clearSelection}
                >
                  {hasActiveFilters ? <FilterX className="h-3.5 w-3.5" /> : <SlidersHorizontal className="h-3.5 w-3.5" />}
                  {hasActiveFilters ? "Clear local filters" : "Clear selection"}
                </Button>
              </div>
            </div>

            {overview.insights.length > 0 ? (
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                {overview.insights.slice(0, 4).map(insight => (
                  <div
                    key={insight.title}
                    className={cn(
                      "rounded-xl border px-3 py-3 text-sm shadow-sm",
                      insight.tone === "warning"
                        ? "border-amber-500/30 bg-amber-500/10"
                        : insight.tone === "positive"
                          ? "border-emerald-500/30 bg-emerald-500/10"
                          : "border-border/60 bg-background/70",
                    )}
                  >
                    <div className="mb-1 flex items-center gap-2 font-medium text-foreground">
                      {insight.tone === "warning" ? <Target className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                      {insight.title}
                    </div>
                    <div className="text-xs leading-5 text-muted-foreground">{insight.body}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <InspectorSummaryStrip
          overview={overview}
          visibleCount={visibleChains.length}
          totalCount={totalChains}
          selectedCount={selectedCount}
          scoreColumn={scoreColumn}
        />

        {mixedComparisonScope ? (
          <InlineError message="The current scope mixes multiple task types or score metrics. Global comparisons will be harder to interpret until you filter to one task and one metric." />
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,1fr)]">
          <InspectorSectionCard
            title="Model × preprocessing landscape"
            description="Median score per model family and preprocessing pipeline. Click a cell to focus those chains."
            contentClassName="h-[360px]"
          >
            <PerformanceHeatmap data={heatmapData} isLoading={false} />
          </InspectorSectionCard>

          <div className="grid gap-4">
            <InspectorSectionCard
              title="Model family leaderboard"
              description="Typical and best scores per model family. Click a row to move the diagnostics scope."
              contentClassName="pt-0"
            >
              <InspectorGroupedLeaderboard
                summaries={overview.modelSummaries}
                metric={overview.metric}
                emptyMessage="No model family summary available."
              />
            </InspectorSectionCard>

            <InspectorSectionCard
              title="Dataset difficulty"
              description="Median score per dataset in the current scope. Use this to spot where models generalize poorly."
              contentClassName="pt-0"
            >
              <InspectorGroupedLeaderboard
                summaries={overview.datasetSummaries}
                metric={overview.metric}
                emptyMessage="No dataset summary available."
                maxRows={6}
              />
            </InspectorSectionCard>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <InspectorSectionCard
            title="Score distribution"
            description="How scores are distributed across the current scope. Click bins to add chains to the selection."
            contentClassName="h-[330px]"
          >
            <ScoreHistogram data={histogramData} groups={activeGroups} isLoading={false} />
          </InspectorSectionCard>

          <InspectorSectionCard
            title="Spread by model family"
            description="Box plots reveal stability, outliers, and the spread of scores within each model family."
            contentClassName="h-[330px]"
          >
            <CandlestickChart data={candlestickData} isLoading={false} />
          </InspectorSectionCard>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
          <InspectorSectionCard
            title="Chain ranking"
            description="Best chains in the current scope. Selecting rows rewires the diagnostics section below."
            contentClassName="h-[420px]"
          >
            <RankingsTable data={rankingsData} groups={activeGroups} isLoading={false} />
          </InspectorSectionCard>

          <InspectorSectionCard
            title="Preprocessing step impact"
            description="Average gain or loss associated with each preprocessing step across the current scope."
            contentClassName="h-[420px]"
          >
            <PreprocessingImpact data={preprocessingImpactData} isLoading={false} />
          </InspectorSectionCard>
        </div>

        <InspectorSectionCard
          title="Diagnostics"
          description={`Detailed prediction behavior for ${diagnosticsScope}. If nothing is selected, diagnostics use the top-ranked chains.`}
          headerRight={(
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {selectedVisibleIds.length > 0 ? (
                <Badge variant="secondary">{selectedVisibleIds.length} selected</Badge>
              ) : (
                <Badge variant="outline">auto focus</Badge>
              )}
            </div>
          )}
          contentClassName="space-y-4"
        >
          <Tabs defaultValue="behavior">
            <TabsList>
              <TabsTrigger value="behavior">Behavior</TabsTrigger>
              <TabsTrigger value="sensitivity">Sensitivity</TabsTrigger>
            </TabsList>

            <TabsContent value="behavior" className="space-y-4">
              {diagnosticsTaskKinds.length !== 1 ? (
                <EmptyState
                  icon={Target}
                  title="Diagnostics need a narrower scope"
                  description="The current diagnostic scope mixes incompatible task types, or no chains are selected. Filter to one task type or select a coherent subset from the rankings or heatmap."
                  className="border-border/60"
                />
              ) : diagnosticsTaskKinds[0] === "classification" ? (
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                  <InspectorSectionCard
                    title="Confusion matrix"
                    description="Class-level prediction behavior for the focused chains."
                    contentClassName="h-[360px]"
                  >
                    {confusionQuery.error ? (
                      <InlineError message={getErrorMessage(confusionQuery.error, "Failed to load confusion matrix.")} />
                    ) : (
                      <ConfusionMatrixChart data={confusionQuery.data} isLoading={confusionQuery.isLoading} />
                    )}
                  </InspectorSectionCard>

                  <InspectorSectionCard
                    title="Focused ranking"
                    description="The same ranking table remains the fastest way to refine the classification scope."
                    contentClassName="h-[360px]"
                  >
                    <RankingsTable data={rankingsData} groups={activeGroups} isLoading={false} />
                  </InspectorSectionCard>
                </div>
              ) : (
                <>
                  <div className="grid gap-4 xl:grid-cols-2">
                    <InspectorSectionCard
                      title="Predicted vs observed"
                      description="Are the focused chains calibrated around the ideal diagonal?"
                      contentClassName="h-[360px]"
                    >
                      {scatterQuery.error ? (
                        <InlineError message={getErrorMessage(scatterQuery.error, "Failed to load scatter data.")} />
                      ) : (
                        <PredVsObsChart data={scatterQuery.data} groups={activeGroups} isLoading={scatterQuery.isLoading} />
                      )}
                    </InspectorSectionCard>

                    <InspectorSectionCard
                      title="Residual patterns"
                      description="Look for curvature, widening error bands, or strong prediction bias."
                      contentClassName="h-[360px]"
                    >
                      {scatterQuery.error ? (
                        <InlineError message={getErrorMessage(scatterQuery.error, "Failed to load residual data.")} />
                      ) : (
                        <ResidualsChart data={scatterQuery.data} isLoading={scatterQuery.isLoading} />
                      )}
                    </InspectorSectionCard>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
                    <InspectorSectionCard
                      title="Fold stability"
                      description="Compare per-fold behavior before trusting a top-ranked chain as genuinely robust."
                      contentClassName="h-[320px]"
                    >
                      {foldStabilityQuery.error ? (
                        <InlineError message={getErrorMessage(foldStabilityQuery.error, "Failed to load fold stability.")} />
                      ) : (
                        <FoldStabilityChart data={foldStabilityQuery.data} groups={activeGroups} isLoading={foldStabilityQuery.isLoading} />
                      )}
                    </InspectorSectionCard>

                    <InspectorSectionCard
                      title="Bias-variance decomposition"
                      description="Bias and variance aggregated by model family for the focused chains."
                      contentClassName="h-[320px]"
                    >
                      {biasVarianceQuery.error ? (
                        <InlineError message={getErrorMessage(biasVarianceQuery.error, "Failed to load bias-variance analysis.")} />
                      ) : (
                        <BiasVariance data={biasVarianceQuery.data} isLoading={biasVarianceQuery.isLoading} />
                      )}
                    </InspectorSectionCard>
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="sensitivity" className="space-y-4">
              <InspectorSectionCard
                title="Hyperparameter sensitivity"
                description="Numeric hyperparameters extracted from best parameters across the visible scope."
                headerRight={availableHyperParams.length > 0 ? (
                  <Select value={activeHyperParam} onValueChange={setSelectedHyperParam}>
                    <SelectTrigger className="h-8 w-[180px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableHyperParams.map(param => (
                        <SelectItem key={param} value={param}>
                          {param}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
                contentClassName="h-[360px]"
              >
                <HyperparameterSensitivity data={hyperparameterData} isLoading={false} />
              </InspectorSectionCard>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                <InspectorSectionCard
                  title="Interpretation guide"
                  description="Use the same scope logic throughout the page so each chart answers a different question."
                  contentClassName="space-y-3"
                >
                  <div className="rounded-xl border border-border/60 bg-background/70 p-3 text-sm">
                    <div className="mb-1 flex items-center gap-2 font-medium text-foreground">
                      <ArrowUpRight className="h-4 w-4" />
                      Start global, then narrow
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">
                      Use the heatmap, distribution, and ranking sections to find promising pockets, then click a cell, bin, or row to send just those chains into diagnostics.
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-background/70 p-3 text-sm">
                    <div className="mb-1 flex items-center gap-2 font-medium text-foreground">
                      <Sparkles className="h-4 w-4" />
                      Compare like with like
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">
                      The most meaningful comparisons come from one task type, one score metric, and one dataset family. Mixed scopes are fine for browsing, not for decisions.
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-background/70 p-3 text-sm">
                    <div className="mb-1 flex items-center gap-2 font-medium text-foreground">
                      <Target className="h-4 w-4" />
                      Treat hyperparameters as evidence, not truth
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">
                      A clean slope suggests a real tuning effect. A noisy cloud usually means the model family or preprocessing strategy matters more than that single parameter.
                    </p>
                  </div>
                </InspectorSectionCard>

                <InspectorSectionCard
                  title="Focused scope summary"
                  description="What currently feeds the diagnostics."
                  contentClassName="space-y-3"
                >
                  <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Scope</div>
                    <div className="mt-1 text-lg font-semibold text-foreground">{diagnosticsScope}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {diagnosticsTaskKinds.length === 1
                        ? `${diagnosticsTaskKinds[0]} • ${partition} partition`
                        : "mixed tasks or empty scope"}
                    </div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Score range</div>
                    <div className="mt-1 text-lg font-semibold text-foreground">
                      {overview.scoreRange
                        ? `${formatMetricValue(overview.scoreRange[0], overview.metric ?? undefined)} to ${formatMetricValue(overview.scoreRange[1], overview.metric ?? undefined)}`
                        : "—"}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {overview.scoreableCount} score-bearing chains in the current scope
                    </div>
                  </div>
                </InspectorSectionCard>
              </div>
            </TabsContent>
          </Tabs>
        </InspectorSectionCard>
      </div>
    </div>
  );
}
