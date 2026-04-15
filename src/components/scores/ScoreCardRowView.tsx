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
import { formatMetricValue, getMetricAbbreviation, isClassificationTaskType } from "@/lib/scores";
import { foldBadgeClasses, foldLabel, foldLabelShort, safeNumber } from "@/lib/fold-utils";
import { formatBestParams } from "@/lib/score-adapters";
import { cardTypeBorderClass } from "./ScoreColumns";
import { ModelActionMenu } from "./ModelActionMenu";
import type { ScoreCardRow } from "@/types/score-cards";

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
    <div className="flex flex-col items-center min-w-[38px]">
      <span className="text-muted-foreground uppercase text-[7px] font-medium tracking-wide leading-none">{label}</span>
      <span className={cn("font-mono text-[11px] tabular-nums leading-tight", colorClass || "text-foreground/70")}>
        {val != null ? formatMetricValue(val, metric) : "\u2014"}
      </span>
    </div>
  );
}

// Score extraction helpers
function getTestScore(row: ScoreCardRow, key: string): number | null {
  return safeNumber(row.testScores[key]);
}
function getValScore(row: ScoreCardRow, key: string): number | null {
  return safeNumber(row.valScores[key]);
}
function getTrainScore(row: ScoreCardRow, key: string): number | null {
  return safeNumber(row.trainScores[key]);
}
function getAnyScore(row: ScoreCardRow, key: string): number | null {
  return safeNumber(row.testScores[key]) ?? safeNumber(row.valScores[key]) ?? safeNumber(row.trainScores[key]);
}

// ============================================================================
// Type-specific score displays
// ============================================================================

/** REFIT: RMSEP | Train_RMSE | R² | SEP | RPD | BIAS | MAE | NRMSE */
function RefitScores({ row }: { row: ScoreCardRow }) {
  const primaryMetric = (row.metric || (isClassificationTaskType(row.taskType) ? "accuracy" : "rmse")).toLowerCase();

  if (isClassificationTaskType(row.taskType)) {
    const secondaryMetrics = [
      { key: "f1", label: "F1" },
      { key: "roc_auc", label: "AUC" },
      { key: "balanced_accuracy", label: "BalAcc" },
      { key: "precision", label: "Prec" },
      { key: "recall", label: "Recall" },
      { key: "matthews_corrcoef", label: "MCC" },
    ].filter(metric => metric.key !== primaryMetric);

    return (
      <div className="flex items-center gap-1.5 flex-wrap">
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

  const secondaryMetrics = [
    { key: "r2", label: "R²" },
    { key: "sep", label: "SEP" },
    { key: "rpd", label: "RPD" },
    { key: "bias", label: "BIAS" },
    { key: "mae", label: "MAE" },
    { key: "nrmse", label: "NRMSE" },
  ].filter(metric => metric.key !== primaryMetric);
  const primaryLabel = primaryMetric === "rmse" || primaryMetric === "rmsep"
    ? "RMSEP"
    : getMetricAbbreviation(primaryMetric);

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
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
function CrossvalScores({ row }: { row: ScoreCardRow }) {
  const primaryMetric = (row.metric || (isClassificationTaskType(row.taskType) ? "accuracy" : "rmse")).toLowerCase();

  if (isClassificationTaskType(row.taskType)) {
    const secondaryMetrics = [
      { key: "roc_auc", label: "AUC" },
      { key: "f1", label: "F1" },
      { key: "balanced_accuracy", label: "BalAcc" },
      { key: "precision", label: "Prec" },
      { key: "recall", label: "Recall" },
    ].filter(metric => metric.key !== primaryMetric);
    const primaryLabel = getMetricAbbreviation(primaryMetric);

    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        <ScorePair
          label={`${primaryLabel} CV`}
          value={row.primaryValScore ?? safeNumber(row.avgValScores?.[primaryMetric])}
          metric={primaryMetric}
          colorClass="text-chart-1 font-semibold"
        />
        <ScorePair label="Mean Val" value={safeNumber(row.meanValScores?.[primaryMetric])} metric={primaryMetric} colorClass="text-blue-400" />
        <ScorePair label="Min Val" value={safeNumber(row.minValScores?.[primaryMetric])} metric={primaryMetric} colorClass="text-blue-400" />
        <ScorePair label="Max Val" value={safeNumber(row.maxValScores?.[primaryMetric])} metric={primaryMetric} colorClass="text-blue-400" />
        <ScorePair
          label={`${primaryLabel} Test`}
          value={row.primaryTestScore ?? safeNumber(row.avgTestScores?.[primaryMetric])}
          metric={primaryMetric}
        />
        {secondaryMetrics.map(metric => (
          <ScorePair
            key={metric.key}
            label={metric.label}
            value={safeNumber(row.avgValScores?.[metric.key]) ?? safeNumber(row.avgTestScores?.[metric.key])}
            metric={metric.key}
            colorClass="text-green-400"
          />
        ))}
      </div>
    );
  }

  const rmseLike = primaryMetric === "rmse" || primaryMetric === "rmsecv" || primaryMetric === "rmsep";
  const primaryKey = row.metric || "rmse";
  const meanVal = safeNumber(row.meanValScores?.[primaryMetric]) ?? safeNumber(row.meanValScores?.rmse);
  const minVal = safeNumber(row.minValScores?.[primaryMetric]) ?? safeNumber(row.minValScores?.rmse);
  const maxVal = safeNumber(row.maxValScores?.[primaryMetric]) ?? safeNumber(row.maxValScores?.rmse);
  const meanTest = safeNumber(row.meanTestScores?.[primaryMetric]) ?? safeNumber(row.meanTestScores?.rmse);
  const minTest = safeNumber(row.minTestScores?.[primaryMetric]) ?? safeNumber(row.minTestScores?.rmse);
  const maxTest = safeNumber(row.maxTestScores?.[primaryMetric]) ?? safeNumber(row.maxTestScores?.rmse);
  const weightedTest = safeNumber(row.wAvgTestScores?.[primaryMetric]) ?? safeNumber(row.wAvgTestScores?.rmse);
  const avgTest = row.primaryTestScore ?? safeNumber(row.avgTestScores?.[primaryMetric]) ?? safeNumber(row.avgTestScores?.rmse);

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <ScorePair label={rmseLike ? "RMSECV" : "CV"} value={row.primaryValScore ?? safeNumber(row.avgValScores?.[primaryMetric]) ?? safeNumber(row.avgValScores?.rmse)} metric={primaryKey} colorClass="text-chart-1 font-semibold" />
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
function TrainScores({ row }: { row: ScoreCardRow }) {
  const primaryMetric = (row.metric || (isClassificationTaskType(row.taskType) ? "accuracy" : "rmse")).toLowerCase();

  if (isClassificationTaskType(row.taskType)) {
    const secondaryMetrics = [
      { key: "f1", label: "F1" },
      { key: "roc_auc", label: "AUC" },
      { key: "balanced_accuracy", label: "BalAcc" },
      { key: "precision", label: "Prec" },
      { key: "recall", label: "Recall" },
      { key: "matthews_corrcoef", label: "MCC" },
    ].filter(metric => metric.key !== primaryMetric);

    return (
      <div className="flex items-center gap-1.5 flex-wrap">
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

  const secondaryMetrics = [
    { key: "r2", label: "R²" },
    { key: "sep", label: "SEP" },
    { key: "rpd", label: "RPD" },
    { key: "bias", label: "BIAS" },
    { key: "mae", label: "MAE" },
    { key: "nrmse", label: "NRMSE" },
  ].filter(metric => metric.key !== primaryMetric);
  const primaryLabel = primaryMetric === "rmse" || primaryMetric === "rmsep"
    ? "RMSEP"
    : getMetricAbbreviation(primaryMetric);

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
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

// ============================================================================
// InlineRow — card-style row for Runs/Results pages
// ============================================================================

function InlineRow({
  row, selectedMetrics, workspaceId, rank, expandable, expanded, onToggleExpand, onViewDetails, onViewPrediction, indent = 0,
}: ScoreCardRowViewProps) {
  const borderClass = cardTypeBorderClass(row.cardType);
  const isRefit = row.cardType === "refit";
  const isCrossval = row.cardType === "crossval";
  const isTrain = row.cardType === "train";

  const paramLabel = row.bestParams ? formatBestParams(row.bestParams) : null;

  return (
    <div className={cn("rounded-md border", borderClass, expanded && "bg-muted/5", indent > 0 && "ml-4")}>
      {/* Identity line */}
      <div className="flex items-center gap-1 min-h-[32px]">
        <button
          className="flex items-center gap-1.5 shrink-0 py-1 px-2 text-left hover:bg-muted/30 rounded-l-md transition-colors"
          onClick={onToggleExpand}
        >
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
            "text-[10px] font-mono shrink-0",
            isRefit && "border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
            isCrossval && "border-chart-1/30 text-chart-1",
          )}>
            <Box className="h-2.5 w-2.5 mr-0.5" />{row.modelName}
          </Badge>

          <CardTypeBadge row={row} />

          {paramLabel && <span className="text-[10px] text-muted-foreground truncate max-w-[120px]" title={paramLabel}>{paramLabel}</span>}

          {isTrain && row.partition && <Badge variant="secondary" className="text-[9px] shrink-0">{row.partition}</Badge>}
          {row.nSamplesEval != null && <span className="text-[10px] text-muted-foreground shrink-0">n={row.nSamplesEval}</span>}
          {isCrossval && row.foldCount != null && row.foldCount > 0 && <span className="text-[10px] text-muted-foreground shrink-0">{row.foldCount} folds</span>}
        </button>

        {/* Scores area */}
        <div className="flex-1 min-w-0 flex items-center justify-end gap-2 pr-2">
          {isRefit && <RefitScores row={row} />}
          {isCrossval && <CrossvalScores row={row} />}
          {isTrain && <TrainScores row={row} />}

          {/* Actions */}
          <div className="flex items-center gap-0.5 shrink-0 ml-1">
            {onViewPrediction && isTrain && (
              <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={(e) => { e.stopPropagation(); onViewPrediction(row.id); }} title="View prediction">
                <Eye className="h-3 w-3" />
              </Button>
            )}
            {row.hasRefitArtifact && (
              <Button variant="ghost" size="sm" className="h-5 w-5 p-0" asChild title="Predict">
                <Link to={`/predict?model_id=${encodeURIComponent(row.chainId)}&source=chain`}><Zap className="h-3 w-3 text-emerald-500" /></Link>
              </Button>
            )}
            {!isTrain && (
              <ModelActionMenu
                chainId={row.chainId}
                modelName={row.modelName}
                datasetName={row.datasetName}
                runId={row.runId}
                hasRefit={row.hasRefitArtifact}
                workspaceId={workspaceId}
                deleteScope="chain"
                onViewDetails={onViewDetails}
              />
            )}
          </div>
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
  onViewDetails, onViewPrediction,
}: ScoreCardRowViewProps) {
  const isRefit = row.cardType === "refit";
  const metric = row.metric || "rmse";
  const foldDisplay = row.foldId ? foldLabelShort(row.foldId) : (row.foldCount ?? "\u2014");

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
      {selectedMetrics.slice(0, 4).map(k => {
        const val = getAnyScore(row, k);
        return <TableCell key={k} className="text-right font-mono text-[11px] text-muted-foreground">{val != null ? formatMetricValue(val, k) : "\u2014"}</TableCell>;
      })}
      <TableCell onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-0.5">
          {onViewPrediction && row.cardType === "train" && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onViewPrediction(row.id)}><Eye className="h-3.5 w-3.5" /></Button>
          )}
          <ModelActionMenu
            chainId={row.chainId}
            modelName={row.modelName}
            datasetName={row.datasetName}
            runId={row.runId}
            hasRefit={row.hasRefitArtifact}
            workspaceId={workspaceId}
            deleteScope="group"
            foldId={row.foldId}
            onViewDetails={onViewDetails}
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
