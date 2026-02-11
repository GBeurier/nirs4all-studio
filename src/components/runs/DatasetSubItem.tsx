import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  ChevronDown, ChevronRight, Database, Eye, ExternalLink,
  TrendingUp, TrendingDown, Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatScore } from "@/lib/scores";
import type { EnrichedDatasetRun } from "@/types/enriched-runs";
import { TopScoreItem } from "./TopScoreItem";
import { RunQuickView } from "./RunQuickView";

interface DatasetSubItemProps {
  dataset: EnrichedDatasetRun;
  runId: string;
  runName: string;
  workspaceId: string;
}

function GainBadge({ gain, metric }: { gain: number | null; metric: string | null }) {
  if (gain == null) return null;
  // For lower-is-better metrics, negative gain is improvement
  const lowerBetter = ["rmse", "mse", "mae", "mape", "rmsecv", "rmsep", "bias", "sep"].includes(
    (metric || "").toLowerCase()
  );
  const isImprovement = lowerBetter ? gain < 0 : gain > 0;
  const isEqual = Math.abs(gain) < 0.0001;

  if (isEqual) {
    return (
      <Badge variant="secondary" className="text-xs">
        <Minus className="h-3 w-3 mr-0.5" />0
      </Badge>
    );
  }

  return (
    <Badge variant={isImprovement ? "default" : "secondary"} className={cn("text-xs", isImprovement && "bg-chart-1/20 text-chart-1 border-chart-1/30")}>
      {isImprovement ? <TrendingUp className="h-3 w-3 mr-0.5" /> : <TrendingDown className="h-3 w-3 mr-0.5" />}
      {gain > 0 ? "+" : ""}{gain.toFixed(4)}
    </Badge>
  );
}

export function DatasetSubItem({ dataset, runId, runName, workspaceId }: DatasetSubItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [quickViewOpen, setQuickViewOpen] = useState(false);

  return (
    <>
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <CollapsibleTrigger asChild>
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-3 min-w-0">
              {expanded ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <Database className="h-4 w-4 text-primary shrink-0" />
              <span className="font-medium text-sm truncate">{dataset.dataset_name}</span>
              {(dataset.best_final_score != null || dataset.best_avg_val_score != null) && (
                <Badge variant="outline" className={cn(
                  "text-xs font-mono shrink-0",
                  dataset.best_final_score != null
                    ? "text-emerald-500 border-emerald-500/30"
                    : "text-chart-1 border-chart-1/30",
                )}>
                  {dataset.best_final_score != null ? (
                    <>Final {dataset.metric?.toUpperCase()} {formatScore(dataset.best_final_score)}</>
                  ) : (
                    <>{dataset.metric?.toUpperCase()} {formatScore(dataset.best_avg_val_score)}</>
                  )}
                </Badge>
              )}
              <GainBadge gain={dataset.gain_from_previous_best} metric={dataset.metric} />
              <Badge variant="secondary" className="text-xs shrink-0">
                {dataset.pipeline_count} pipelines
              </Badge>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={(e) => { e.stopPropagation(); setQuickViewOpen(true); }}
              >
                <Eye className="h-3.5 w-3.5 mr-1" />
                QuickView
              </Button>
              <Button variant="ghost" size="sm" className="text-xs" asChild onClick={(e) => e.stopPropagation()}>
                <Link to={`/predictions?run_id=${encodeURIComponent(runId)}&dataset=${encodeURIComponent(dataset.dataset_name)}`}>
                  <ExternalLink className="h-3.5 w-3.5 mr-1" />
                  Predictions
                </Link>
              </Button>
            </div>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="ml-8 mt-1 space-y-1">
            {dataset.top_5.length > 0 ? (
              dataset.top_5.map((chain, index) => (
                <TopScoreItem
                  key={chain.chain_id}
                  chain={chain}
                  rank={index + 1}
                  taskType={dataset.task_type}
                  runId={runId}
                  datasetName={dataset.dataset_name}
                />
              ))
            ) : (
              <div className="text-xs text-muted-foreground py-2 text-center">
                No scored chains available
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      <RunQuickView
        open={quickViewOpen}
        onOpenChange={setQuickViewOpen}
        runId={runId}
        runName={runName}
        datasetName={dataset.dataset_name}
        metric={dataset.metric}
        workspaceId={workspaceId}
      />
    </>
  );
}
