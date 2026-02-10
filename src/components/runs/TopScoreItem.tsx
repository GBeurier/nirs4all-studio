import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Box, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TopChainResult } from "@/types/enriched-runs";

interface TopScoreItemProps {
  chain: TopChainResult;
  rank: number;
  taskType: string | null;
  runId: string;
  datasetName: string;
}

// Metrics to show per task type
const REGRESSION_METRICS = ["r2", "rmse", "rpd"] as const;
const CLASSIFICATION_METRICS = ["accuracy", "f1", "auc"] as const;

function getMetricsToShow(taskType: string | null): readonly string[] {
  if (taskType === "classification") return CLASSIFICATION_METRICS;
  return REGRESSION_METRICS;
}

function formatMetricValue(value: number | undefined | null, metric: string): string {
  if (value == null) return "-";
  // RMSE can be large, use fewer decimals
  if (["rmse", "mse", "mae"].includes(metric)) return value.toFixed(3);
  return value.toFixed(4);
}

export function TopScoreItem({ chain, rank, taskType, runId, datasetName }: TopScoreItemProps) {
  const metrics = getMetricsToShow(taskType);

  return (
    <div className={cn(
      "flex items-center justify-between p-2.5 rounded-md border bg-card text-sm",
      rank === 1 && "border-chart-1/30 bg-chart-1/5",
    )}>
      <div className="flex items-center gap-3 min-w-0">
        {/* Rank badge */}
        <span className={cn(
          "w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
          rank === 1 ? "bg-chart-1/20 text-chart-1" : "bg-muted text-muted-foreground",
        )}>
          {rank}
        </span>
        {/* Chain info */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-xs font-mono shrink-0">
              <Box className="h-3 w-3 mr-1" />
              {chain.model_name}
            </Badge>
            {chain.preprocessings && (
              <span className="text-xs text-muted-foreground truncate max-w-[200px]" title={chain.preprocessings}>
                {chain.preprocessings}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 2x3 score grid */}
      <div className="flex items-center gap-4 shrink-0">
        <div className="grid grid-cols-3 gap-x-4 gap-y-0.5 text-xs">
          {/* Header row */}
          {metrics.map((m) => (
            <span key={`h-${m}`} className="text-muted-foreground font-medium text-center uppercase text-[10px]">
              {m}
            </span>
          ))}
          {/* Val row */}
          {metrics.map((m) => (
            <span key={`v-${m}`} className="font-mono text-chart-1 text-center">
              {formatMetricValue(chain.scores?.val?.[m], m)}
            </span>
          ))}
          {/* Test row */}
          {metrics.map((m) => (
            <span key={`t-${m}`} className="font-mono text-muted-foreground text-center">
              {formatMetricValue(chain.scores?.test?.[m], m)}
            </span>
          ))}
        </div>

        {/* Actions */}
        <Button variant="ghost" size="sm" className="text-xs h-7" asChild>
          <Link to={`/predictions?run_id=${encodeURIComponent(runId)}&dataset=${encodeURIComponent(datasetName)}&model=${encodeURIComponent(chain.model_name)}`}>
            <ExternalLink className="h-3 w-3" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
