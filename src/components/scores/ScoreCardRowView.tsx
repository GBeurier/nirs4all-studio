/**
 * ScoreCardRowView — unified row component for TRAIN, CROSSVAL, and REFIT cards.
 *
 * Each card type shows specific fixed score columns:
 *
 * REFIT:    Model | Params | RMSEP | Train_RMSE | R² | SEP | RPD | BIAS | MAE | NRMSE
 * CROSSVAL: Model | Params | RMSECV | Mean_Val | Min_Val | Max_Val | RMSEP_Avg | RMSEP_W-Avg | Mean_RMSEP | Min_Test | Max_Test
 * TRAIN:    Model | Fold | Partition | N | RMSEP | Val_RMSE | R² | SEP | RPD | BIAS | MAE | NRMSE
 *
 * Two rendering modes:
 * - variant="inline": Card-style row for Runs/Results pages
 * - variant="table-row": Table row for Predictions per-fold view
 */

import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  ChevronDown, ChevronRight, Award, Box, Zap, Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  canonicalMetricKey,
  filterMetricsForTaskType,
  formatMetricValue,
  getDefaultSelectedMetrics,
  getMetricAbbreviation,
  getScoreMapValue,
  isClassificationTaskType,
  orderMetricKeys,
} from "@/lib/scores";
import { foldBadgeClasses, foldLabel, foldLabelShort, safeNumber } from "@/lib/fold-utils";
import { formatBestParams } from "@/lib/score-adapters";
import { cardTypeBorderClass } from "./ScoreColumns";
import { ModelActionMenu, type ModelActionChartView } from "./ModelActionMenu";
import type { ScoreCardRow, ScoreCardType } from "@/types/score-cards";

// ============================================================================
// Props
// ============================================================================

interface ScoreCardRowViewProps {
  row: ScoreCardRow;
  selectedMetrics: string[];
  workspaceId?: string;
  rank?: number;
  variant: "inline" | "table-row";
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onViewDetails?: () => void;
  onViewPrediction?: (predictionId: string) => void;
  onOpenChart?: (row: ScoreCardRow, view: ModelActionChartView) => void;
  indent?: number;
  maxTableMetrics?: number;
}

// ============================================================================
// Score display helpers
// ============================================================================

function ScorePair({ label, value, metric, colorClass }: {
  label: string;
  value: number | null | undefined;
  metric: string;
  colorClass?: string;
}) {
  const val = safeNumber(value);
  return (
    <div className="flex w-[4.1rem] shrink-0 flex-col items-center text-center">
      <span className="min-h-[0.75rem] text-muted-foreground uppercase text-[7px] font-medium tracking-wide leading-none">{label}</span>
      <span className={cn("font-mono text-[11px] tabular-nums leading-tight", colorClass || "text-foreground/70")}>
        {val != null ? formatMetricValue(val, metric) : "\u2014"}
      </span>
    </div>
  );
}

// Score extraction helpers
function getTestScore(row: ScoreCardRow, key: string): number | null {
  return getScoreMapValue(row.testScores, key);
}
function getValScore(row: ScoreCardRow, key: string): number | null {
  return getScoreMapValue(row.valScores, key);
}
function getTrainScore(row: ScoreCardRow, key: string): number | null {
  return getScoreMapValue(row.trainScores, key);
}
function getAnyScore(row: ScoreCardRow, key: string): number | null {
  return getScoreMapValue(row.testScores, key) ?? getScoreMapValue(row.valScores, key) ?? getScoreMapValue(row.trainScores, key);
}

function getPrimaryMetric(row: ScoreCardRow): string {
  return canonicalMetricKey(row.metric || (isClassificationTaskType(row.taskType) ? "accuracy" : "rmse"));
}

function getRelevantMetricKeys(row: ScoreCardRow, selectedMetrics: string[]): string[] {
  const primaryMetric = getPrimaryMetric(row);
  const scopedSelection = filterMetricsForTaskType(selectedMetrics, row.taskType);
  const fallbackSelection = filterMetricsForTaskType(getDefaultSelectedMetrics(row.taskType ?? null), row.taskType);
  const relevantMetrics = scopedSelection.length > 0 ? scopedSelection : fallbackSelection;

  return orderMetricKeys([primaryMetric, ...relevantMetrics]);
}

// ============================================================================
// Type-specific score displays
// ============================================================================

/** REFIT: RMSEP | Train_RMSE | R² | SEP | RPD | BIAS | MAE | NRMSE */
function RefitScores({ row, selectedMetrics }: { row: ScoreCardRow; selectedMetrics: string[] }) {
  const primaryMetric = getPrimaryMetric(row);
  const secondaryMetrics = getRelevantMetricKeys(row, selectedMetrics)
    .filter(metric => metric !== primaryMetric)
    .map(metric => ({ key: metric, label: getMetricAbbreviation(metric) }));

  if (isClassificationTaskType(row.taskType)) {
    return (
      <div className="flex min-w-0 items-center justify-start gap-1.5 flex-wrap lg:justify-end">
        <ScorePair
          label={getMetricAbbreviation(primaryMetric)}
          value={row.primaryTestScore ?? getTestScore(row, primaryMetric)}
          metric={primaryMetric}
          colorClass="text-emerald-500 font-semibold"
        />
        <ScorePair
          label="Train"
          value={row.primaryTrainScore ?? getTrainScore(row, primaryMetric)}
          metric={primaryMetric}
          colorClass="text-orange-400"
        />
        {secondaryMetrics.map(metric => (
          <ScorePair key={metric.key} label={metric.label} value={getTestScore(row, metric.key)} metric={metric.key} />
        ))}
      </div>
    );
  }

  const primaryLabel = primaryMetric === "rmse" || primaryMetric === "rmsep"
    ? "RMSEP"
    : getMetricAbbreviation(primaryMetric);

  return (
    <div className="flex min-w-0 items-center justify-start gap-1.5 flex-wrap lg:justify-end">
      <ScorePair
        label={primaryLabel}
        value={row.primaryTestScore ?? getTestScore(row, primaryMetric)}
        metric={primaryMetric}
        colorClass="text-emerald-500 font-semibold"
      />
      <ScorePair
        label="Train"
        value={row.primaryTrainScore ?? getTrainScore(row, primaryMetric)}
        metric={primaryMetric}
        colorClass="text-orange-400"
      />
      {secondaryMetrics.map(metric => (
        <ScorePair key={metric.key} label={metric.label} value={getTestScore(row, metric.key)} metric={metric.key} />
      ))}
    </div>
  );
}

/** CROSSVAL: RMSECV | Mean_Val | Min_Val | Max_Val | RMSEP_Avg | RMSEP_W-Avg | Mean_RMSEP | Min_Test | Max_Test */
function CrossvalScores({ row, selectedMetrics }: { row: ScoreCardRow; selectedMetrics: string[] }) {
  const primaryMetric = getPrimaryMetric(row);
  const secondaryMetrics = getRelevantMetricKeys(row, selectedMetrics)
    .filter(metric => metric !== primaryMetric)
    .map(metric => ({ key: metric, label: getMetricAbbreviation(metric) }));

  if (isClassificationTaskType(row.taskType)) {
    const primaryLabel = getMetricAbbreviation(primaryMetric);

    return (
      <div className="flex min-w-0 items-center justify-start gap-1.5 flex-wrap lg:justify-end">
        <ScorePair
          label={`${primaryLabel} CV`}
          value={row.primaryValScore ?? getScoreMapValue(row.avgValScores, primaryMetric)}
          metric={primaryMetric}
          colorClass="text-chart-1 font-semibold"
        />
        <ScorePair label="Mean Val" value={getScoreMapValue(row.meanValScores, primaryMetric)} metric={primaryMetric} colorClass="text-blue-400" />
        <ScorePair label="Min Val" value={getScoreMapValue(row.minValScores, primaryMetric)} metric={primaryMetric} colorClass="text-blue-400" />
        <ScorePair label="Max Val" value={getScoreMapValue(row.maxValScores, primaryMetric)} metric={primaryMetric} colorClass="text-blue-400" />
        <ScorePair
          label={`${primaryLabel} Test`}
          value={row.primaryTestScore ?? getScoreMapValue(row.avgTestScores, primaryMetric)}
          metric={primaryMetric}
        />
        {secondaryMetrics.map(metric => (
          <ScorePair
            key={metric.key}
            label={metric.label}
            value={getScoreMapValue(row.avgValScores, metric.key) ?? getScoreMapValue(row.avgTestScores, metric.key)}
            metric={metric.key}
            colorClass="text-green-400"
          />
        ))}
      </div>
    );
  }

  const rmseLike = primaryMetric === "rmse";
  const primaryKey = primaryMetric || "rmse";
  const meanVal = getScoreMapValue(row.meanValScores, primaryMetric) ?? getScoreMapValue(row.meanValScores, "rmse");
  const minVal = getScoreMapValue(row.minValScores, primaryMetric) ?? getScoreMapValue(row.minValScores, "rmse");
  const maxVal = getScoreMapValue(row.maxValScores, primaryMetric) ?? getScoreMapValue(row.maxValScores, "rmse");
  const meanTest = getScoreMapValue(row.meanTestScores, primaryMetric) ?? getScoreMapValue(row.meanTestScores, "rmse");
  const minTest = getScoreMapValue(row.minTestScores, primaryMetric) ?? getScoreMapValue(row.minTestScores, "rmse");
  const maxTest = getScoreMapValue(row.maxTestScores, primaryMetric) ?? getScoreMapValue(row.maxTestScores, "rmse");
  const weightedTest = getScoreMapValue(row.wAvgTestScores, primaryMetric) ?? getScoreMapValue(row.wAvgTestScores, "rmse");
  const avgTest = row.primaryTestScore ?? getScoreMapValue(row.avgTestScores, primaryMetric) ?? getScoreMapValue(row.avgTestScores, "rmse");

  return (
    <div className="flex min-w-0 items-center justify-start gap-1.5 flex-wrap lg:justify-end">
      <ScorePair label={rmseLike ? "RMSECV" : "CV"} value={row.primaryValScore ?? getScoreMapValue(row.avgValScores, primaryMetric) ?? getScoreMapValue(row.avgValScores, "rmse")} metric={primaryKey} colorClass="text-chart-1 font-semibold" />
      <ScorePair label="Mean Val" value={meanVal} metric={primaryKey} colorClass="text-blue-400" />
      <ScorePair label="Min Val" value={minVal} metric={primaryKey} colorClass="text-blue-400" />
      <ScorePair label="Max Val" value={maxVal} metric={primaryKey} colorClass="text-blue-400" />
      <ScorePair label={rmseLike ? "RMSEP Avg" : "Test Avg"} value={avgTest} metric={primaryKey} />
      <ScorePair label={rmseLike ? "RMSEP W-Avg" : "Test W-Avg"} value={weightedTest} metric={primaryKey} />
      <ScorePair label={rmseLike ? "Mean RMSEP" : "Mean Test"} value={meanTest} metric={primaryKey} colorClass="text-green-400" />
      <ScorePair label="Min Test" value={minTest} metric={primaryKey} colorClass="text-green-400" />
      <ScorePair label="Max Test" value={maxTest} metric={primaryKey} colorClass="text-green-400" />
    </div>
  );
}

/** TRAIN (fold): RMSEP | Val_RMSE | R² | SEP | RPD | BIAS | MAE | NRMSE */
function TrainScores({ row, selectedMetrics }: { row: ScoreCardRow; selectedMetrics: string[] }) {
  const primaryMetric = getPrimaryMetric(row);
  const secondaryMetrics = getRelevantMetricKeys(row, selectedMetrics)
    .filter(metric => metric !== primaryMetric)
    .map(metric => ({ key: metric, label: getMetricAbbreviation(metric) }));

  if (isClassificationTaskType(row.taskType)) {
    return (
      <div className="flex min-w-0 items-center justify-start gap-1.5 flex-wrap lg:justify-end">
        <ScorePair
          label={getMetricAbbreviation(primaryMetric)}
          value={row.primaryTestScore ?? getAnyScore(row, primaryMetric)}
          metric={primaryMetric}
          colorClass="font-semibold"
        />
        <ScorePair
          label="Val"
          value={row.primaryValScore ?? getValScore(row, primaryMetric)}
          metric={primaryMetric}
          colorClass="text-blue-400"
        />
        {secondaryMetrics.map(metric => (
          <ScorePair key={metric.key} label={metric.label} value={getAnyScore(row, metric.key)} metric={metric.key} />
        ))}
      </div>
    );
  }

  const primaryLabel = primaryMetric === "rmse" || primaryMetric === "rmsep"
    ? "RMSEP"
    : getMetricAbbreviation(primaryMetric);

  return (
    <div className="flex min-w-0 items-center justify-start gap-1.5 flex-wrap lg:justify-end">
      <ScorePair
        label={primaryLabel}
        value={row.primaryTestScore ?? getTestScore(row, primaryMetric)}
        metric={primaryMetric}
        colorClass="font-semibold"
      />
      <ScorePair
        label="Val"
        value={row.primaryValScore ?? getValScore(row, primaryMetric)}
        metric={primaryMetric}
        colorClass="text-blue-400"
      />
      {secondaryMetrics.map(metric => (
        <ScorePair key={metric.key} label={metric.label} value={getAnyScore(row, metric.key)} metric={metric.key} />
      ))}
    </div>
  );
}

// ============================================================================
// CardTypeBadge
// ============================================================================

function CardTypeBadge({ row }: { row: ScoreCardRow }) {
  if (row.cardType === "refit") {
    return (
      <div className="flex items-center gap-1 shrink-0">
        <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
          Refit
        </Badge>
        {row.foldId?.endsWith("_agg") && (
          <Badge variant="outline" className="text-[9px] border-purple-500/30 text-purple-500">
            Aggregated
          </Badge>
        )}
      </div>
    );
  }
  if (row.cardType === "crossval") {
    return (
      <div className="flex items-center gap-1 shrink-0">
        <Badge variant="outline" className="text-[9px] border-chart-1/30 text-chart-1">
          CV
        </Badge>
        {row.foldId?.endsWith("_agg") && (
          <Badge variant="outline" className="text-[9px] border-purple-500/30 text-purple-500">
            Aggregated
          </Badge>
        )}
      </div>
    );
  }
  if (row.foldId) {
    return (
      <Badge variant="outline" className={cn("text-[9px] shrink-0", foldBadgeClasses(row.foldId))}>
        {foldLabel(row.foldId)}
      </Badge>
    );
  }
  return null;
}

function rowShellClass(cardType: ScoreCardType): string {
  switch (cardType) {
    case "refit":
      return "lg:grid lg:grid-cols-[25.5rem_minmax(0,1fr)_auto] lg:items-center lg:gap-2";
    case "crossval":
      return "lg:grid lg:grid-cols-[26rem_minmax(0,1fr)_auto] lg:items-center lg:gap-2";
    case "train":
      return "lg:grid lg:grid-cols-[23rem_minmax(0,1fr)_auto] lg:items-center lg:gap-2";
  }
}

function rowDetailClass(cardType: ScoreCardType): string {
  switch (cardType) {
    case "refit":
      return "lg:grid lg:grid-cols-[14rem_10.5rem] lg:items-center lg:gap-2";
    case "crossval":
      return "lg:grid lg:grid-cols-[14rem_11rem] lg:items-center lg:gap-2";
    case "train":
      return "lg:grid lg:grid-cols-[12rem_10rem] lg:items-center lg:gap-2";
  }
}

// ============================================================================
// InlineRow — card-style row for Runs/Results pages
// ============================================================================

function InlineRow({
  row, selectedMetrics, workspaceId, rank, expandable, expanded, onToggleExpand, onViewDetails, onViewPrediction, onOpenChart, indent = 0,
}: ScoreCardRowViewProps) {
  const borderClass = cardTypeBorderClass(row.cardType);
  const isRefit = row.cardType === "refit";
  const isCrossval = row.cardType === "crossval";
  const isTrain = row.cardType === "train";

  const paramLabel = row.bestParams ? formatBestParams(row.bestParams) : null;

  return (
    <div className={cn("rounded-md border", borderClass, expanded && "bg-muted/5", indent > 0 && "ml-4")}>
      <div className={cn("min-h-[32px] p-1", rowShellClass(row.cardType))}>
        <button
          className={cn(
            "w-full min-w-0 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted/30",
            rowDetailClass(row.cardType),
            expandable || onToggleExpand ? "cursor-pointer" : "cursor-default",
          )}
          onClick={onToggleExpand}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            {expandable ? (
              expanded
                ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
            ) : (
              <span className="w-3 shrink-0" />
            )}

            {isRefit && <Award className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}

            {rank != null && (
              <span className={cn("text-xs font-bold shrink-0", isRefit ? "text-emerald-600" : "text-muted-foreground")}>#{rank}</span>
            )}

            <Badge variant="outline" className={cn(
              "min-w-0 max-w-full text-[10px] font-mono",
              isRefit && "border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
              isCrossval && "border-chart-1/30 text-chart-1",
            )}>
              <Box className="mr-0.5 h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{row.modelName}</span>
            </Badge>
          </div>

          <div className="mt-1 flex min-w-0 items-center gap-1.5 flex-wrap lg:mt-0 lg:flex-nowrap">
            <CardTypeBadge row={row} />

            {paramLabel && (
              <span className="min-w-0 truncate text-[10px] text-muted-foreground" title={paramLabel}>
                {paramLabel}
              </span>
            )}

            {isTrain && row.partition && <Badge variant="secondary" className="text-[9px] shrink-0">{row.partition}</Badge>}
            {row.nSamplesEval != null && <span className="text-[10px] text-muted-foreground shrink-0">n={row.nSamplesEval}</span>}
            {isCrossval && row.foldCount != null && row.foldCount > 0 && <span className="text-[10px] text-muted-foreground shrink-0">{row.foldCount} folds</span>}
          </div>
        </button>

        <div className="mt-1 flex min-w-0 items-center justify-start gap-2 px-2 lg:mt-0 lg:justify-end lg:px-0">
          {isRefit && <RefitScores row={row} selectedMetrics={selectedMetrics} />}
          {isCrossval && <CrossvalScores row={row} selectedMetrics={selectedMetrics} />}
          {isTrain && <TrainScores row={row} selectedMetrics={selectedMetrics} />}
        </div>

        <div className="mt-1 flex items-center justify-end gap-0.5 px-2 lg:mt-0 lg:px-0">
          {onViewPrediction && isTrain && (
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={(e) => { e.stopPropagation(); onViewPrediction(row.id); }} title="View prediction">
              <Eye className="h-3 w-3" />
            </Button>
          )}
          {row.hasRefitArtifact && (
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0" asChild title="Predict">
              <Link to={`/predict?model_id=${encodeURIComponent(row.predictChainId || row.chainId)}&source=chain`}><Zap className="h-3 w-3 text-emerald-500" /></Link>
            </Button>
          )}
          {isRefit && !row.hasRefitArtifact && <span className="block h-5 w-5 shrink-0" aria-hidden="true" />}
          {!isTrain && (
            <ModelActionMenu
              chainId={row.chainId}
              predictChainId={row.predictChainId}
              modelName={row.modelName}
              datasetName={row.datasetName}
              runId={row.runId}
              taskType={row.taskType}
              hasRefit={row.hasRefitArtifact}
              workspaceId={workspaceId}
              deleteScope="chain"
              onViewDetails={onViewDetails}
              onOpenChart={onOpenChart ? (view) => onOpenChart(row, view) : undefined}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// TableRowVariant — table-row for Predictions per-fold page
// ============================================================================

function TableRowVariant({
  row, selectedMetrics, workspaceId, rank, expanded, onToggleExpand,
  onViewDetails, onViewPrediction, onOpenChart, maxTableMetrics,
}: ScoreCardRowViewProps) {
  const isRefit = row.cardType === "refit";
  const metric = canonicalMetricKey(row.metric || "rmse") || "rmse";
  const foldDisplay = row.foldId ? foldLabelShort(row.foldId) : (row.foldCount ?? "\u2014");
  const tableMetricKeys = maxTableMetrics == null ? selectedMetrics : selectedMetrics.slice(0, maxTableMetrics);

  return (
    <TableRow className={cn("text-xs", isRefit && "bg-emerald-500/5", expanded && "bg-primary/5")} onClick={onToggleExpand}>
      <TableCell>
        {rank != null && (
          <span className={cn("w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold", rank === 1 && isRefit ? "bg-emerald-500/20 text-emerald-500" : "bg-muted text-muted-foreground")}>{rank}</span>
        )}
      </TableCell>
      <TableCell><CardTypeBadge row={row} /></TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5">
          {isRefit && <Award className="h-3 w-3 text-emerald-500 shrink-0" />}
          <Badge variant="outline" className={cn("text-[10px] font-mono", isRefit && "border-emerald-500/30 text-emerald-600 dark:text-emerald-400")}>
            <Box className="h-2.5 w-2.5 mr-0.5" />{row.modelName}
          </Badge>
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">{row.datasetName || "\u2014"}</TableCell>
      <TableCell><span className="text-[10px] text-muted-foreground truncate max-w-[120px] block">{row.preprocessings || "\u2014"}</span></TableCell>
      <TableCell className="text-right">
        <span className={cn("font-mono font-semibold", isRefit ? "text-emerald-500" : "text-muted-foreground")}>
          {row.primaryTestScore != null ? formatMetricValue(row.primaryTestScore, metric) : "\u2014"}
        </span>
      </TableCell>
      <TableCell className="text-right font-mono text-chart-1">{row.primaryValScore != null ? formatMetricValue(row.primaryValScore, metric) : "\u2014"}</TableCell>
      <TableCell className="text-right text-muted-foreground">{foldDisplay}</TableCell>
      {tableMetricKeys.map(k => {
        const val = getAnyScore(row, k);
        return <TableCell key={k} className="text-right font-mono text-[11px] text-muted-foreground">{val != null ? formatMetricValue(val, k) : "\u2014"}</TableCell>;
      })}
      <TableCell onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-0.5">
          {onViewPrediction && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onViewPrediction(row.id)}><Eye className="h-3.5 w-3.5" /></Button>
          )}
          <ModelActionMenu
            chainId={row.chainId}
            predictChainId={row.predictChainId}
            modelName={row.modelName}
            datasetName={row.datasetName}
            runId={row.runId}
            taskType={row.taskType}
            hasRefit={row.hasRefitArtifact}
            workspaceId={workspaceId}
            deleteScope="group"
            foldId={row.foldId}
            onViewDetails={onViewDetails}
            onOpenChart={onOpenChart ? (view) => onOpenChart(row, view) : undefined}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

// ============================================================================
// Main export
// ============================================================================

export function ScoreCardRowView(props: ScoreCardRowViewProps) {
  if (props.variant === "table-row") {
    return <TableRowVariant {...props} />;
  }
  return <InlineRow {...props} />;
}
