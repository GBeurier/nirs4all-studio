import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Box, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatScore, formatMetricValue, getMetricsForTaskType } from "@/lib/scores";
import type { TopChainResult } from "@/types/enriched-runs";

interface TopScoreItemProps {
  chain: TopChainResult;
  rank: number;
  taskType: string | null;
  runId: string;
  datasetName: string;
}

function ScoreCell({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-muted-foreground text-[10px] uppercase font-medium">{label}</span>
      <span className={cn("font-mono text-xs", className)}>{value}</span>
    </div>
  );
}

export function TopScoreItem({ chain, rank, taskType, runId, datasetName }: TopScoreItemProps) {
  const metrics = getMetricsForTaskType(taskType);
  const hasFinal = chain.final_test_score != null;

  return (
    <div className={cn(
      "flex items-center justify-between p-2.5 rounded-md border bg-card text-sm",
      rank === 1 && (hasFinal ? "border-emerald-500/30 bg-emerald-500/5" : "border-chart-1/30 bg-chart-1/5"),
    )}>
      <div className="flex items-center gap-3 min-w-0">
        {/* Rank badge */}
        <span className={cn(
          "w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
          rank === 1 ? (hasFinal ? "bg-emerald-500/20 text-emerald-500" : "bg-chart-1/20 text-chart-1") : "bg-muted text-muted-foreground",
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

      <div className="flex items-center gap-4 shrink-0">
        {hasFinal ? (
          /* Final (refit) scores: Final test | CV val | CV test | Final train */
          <div className="flex items-center gap-3 text-xs">
            <ScoreCell
              label="Final"
              value={formatScore(chain.final_test_score)}
              className="font-semibold text-emerald-500 text-sm"
            />
            <ScoreCell
              label="CV"
              value={formatScore(chain.avg_val_score)}
              className="text-muted-foreground"
            />
            <ScoreCell
              label="Test"
              value={formatScore(chain.avg_test_score)}
              className="text-muted-foreground"
            />
            <ScoreCell
              label="Train"
              value={formatScore(chain.final_train_score)}
              className="text-muted-foreground"
            />
            {/* Expanded final metrics if available */}
            {Object.keys(chain.final_scores || {}).length > 0 && (
              <div className="hidden xl:flex gap-2 text-muted-foreground border-l pl-3 ml-1">
                {metrics.filter((m) => chain.final_scores?.[m] != null).map((m) => (
                  <span key={m} className="font-mono">
                    <span className="uppercase text-[10px]">{m}</span>{" "}
                    {formatMetricValue(chain.final_scores[m], m)}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Fallback: CV val/test score grid */
          <div className="grid grid-cols-3 gap-x-4 gap-y-0.5 text-xs">
            {metrics.map((m) => (
              <span key={`h-${m}`} className="text-muted-foreground font-medium text-center uppercase text-[10px]">
                {m}
              </span>
            ))}
            {metrics.map((m) => (
              <span key={`v-${m}`} className="font-mono text-chart-1 text-center">
                {formatMetricValue(chain.scores?.val?.[m], m)}
              </span>
            ))}
            {metrics.map((m) => (
              <span key={`t-${m}`} className="font-mono text-muted-foreground text-center">
                {formatMetricValue(chain.scores?.test?.[m], m)}
              </span>
            ))}
          </div>
        )}

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
