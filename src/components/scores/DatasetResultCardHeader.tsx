import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardHeader } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cardTypeColorClass } from "@/lib/scoreColumnData";
import { cn } from "@/lib/utils";
import type { DatasetResultHeaderSummary } from "@/lib/datasetResultCardData";
import type { TopChainResult } from "@/types/enriched-runs";
import type { ScoreCardRow } from "@/types/score-cards";
import {
  ChevronDown,
  ChevronRight,
  Database,
  Eye,
  ExternalLink,
  TrendingDown,
  Trash2,
} from "lucide-react";
import { InlineScoreDisplay } from "./ScoreColumns";

interface DatasetResultCardHeaderProps extends ComponentPropsWithoutRef<typeof CardHeader> {
  datasetName: string;
  taskType?: string | null;
  expanded: boolean;
  selectedMetrics: string[];
  workspaceId?: string;
  headerSummary: DatasetResultHeaderSummary;
  headerBestRow?: ScoreCardRow;
  headerTopChain: TopChainResult | null;
  onDeleteDataset: () => void;
  onOpenDetails: () => void;
}

export const DatasetResultCardHeader = forwardRef<HTMLDivElement, DatasetResultCardHeaderProps>(function DatasetResultCardHeader({
  datasetName,
  taskType,
  expanded,
  selectedMetrics,
  workspaceId,
  headerSummary,
  headerBestRow,
  headerTopChain,
  onDeleteDataset,
  onOpenDetails,
  className,
  ...triggerProps
}, ref) {
  return (
    <CardHeader
      ref={ref}
      className={cn("p-3 cursor-pointer hover:bg-muted/30 transition-colors", className)}
      {...triggerProps}
    >
      <div className="flex items-center gap-3 lg:grid lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)_auto] lg:items-center">
        <div className="flex items-center gap-2 min-w-0">
          {expanded
            ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
          <div className="p-1.5 rounded-md bg-primary/10">
            <Database className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <h3 className="font-semibold text-sm text-foreground truncate">{datasetName}</h3>
              </TooltipTrigger>
              <TooltipContent>{datasetName}</TooltipContent>
            </Tooltip>
            <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
              {taskType && <span className="capitalize">{taskType}</span>}
              {headerSummary.refitCount > 0 && (
                <Badge variant="secondary" className="text-[9px] h-4 px-1 bg-emerald-500/10 text-emerald-600">
                  {headerSummary.refitCount} refit{headerSummary.refitCount !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>
          </div>
        </div>

        <div className="hidden min-w-0 md:flex lg:justify-self-stretch">
          {headerBestRow && (
            <div className="flex min-w-0 items-center gap-2 lg:grid lg:grid-cols-[minmax(0,6rem)_minmax(0,1fr)_minmax(0,7rem)] lg:items-center">
              <div className="min-w-0 shrink-0">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {headerSummary.bestSummaryLabel}
                </div>
                {headerSummary.delta != null && headerSummary.delta > 0 && (
                  <Badge variant="outline" className="mt-1 h-4 gap-0.5 px-1 text-[9px] text-emerald-500 border-emerald-500/20">
                    <TrendingDown className="h-2.5 w-2.5" />
                    {headerSummary.deltaDirection === "down" ? "\u2193" : "\u2191"}{Math.abs(headerSummary.delta).toFixed(4)}
                  </Badge>
                )}
              </div>
              <InlineScoreDisplay
                row={headerBestRow}
                selectedMetrics={selectedMetrics}
                colorClass={cardTypeColorClass(headerSummary.bestContext)}
              />
              <span className="truncate text-right text-[9px] text-muted-foreground font-mono" title={headerBestRow.preprocessings || ""}>
                {headerBestRow.modelName}
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
              onClick={(event) => {
                event.stopPropagation();
                onDeleteDataset();
              }}
              title="Delete all predictions for this dataset"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
          {headerTopChain && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs gap-1"
              onClick={(event) => {
                event.stopPropagation();
                onOpenDetails();
              }}
            >
              <Eye className="h-3 w-3" /> details
            </Button>
          )}
          <Button variant="ghost" size="sm" className="text-xs h-6" asChild onClick={(event) => event.stopPropagation()}>
            <Link to={`/datasets/${encodeURIComponent(datasetName)}`}>
              <ExternalLink className="h-3 w-3" />
            </Link>
          </Button>
        </div>
      </div>
    </CardHeader>
  );
});
