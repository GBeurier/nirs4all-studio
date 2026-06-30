import {
  Box,
  Database,
  Layers,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatMetricName } from "@/lib/scores";
import type { ChainSummary } from "@/types/aggregated-predictions";

interface ChainDetailSummaryHeaderProps {
  prediction: ChainSummary;
  selectedFoldLabel: string | null;
  preprocessLabel: string;
}

export function ChainDetailSummaryHeader({
  prediction,
  selectedFoldLabel,
  preprocessLabel,
}: ChainDetailSummaryHeaderProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-border/70 bg-background px-6 py-4">
      <div className="flex items-start gap-3">
        <Box className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0">
          <h2 className="truncate font-mono text-base font-semibold tracking-tight">
            {prediction.model_name ?? prediction.model_class}
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Database className="h-3 w-3" />
              {prediction.dataset_name}
            </span>
            {prediction.metric && (
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                {formatMetricName(prediction.metric)}
              </Badge>
            )}
            {prediction.task_type && (
              <Badge variant="outline" className="h-5 px-1.5 text-[10px] capitalize">
                {prediction.task_type}
              </Badge>
            )}
            {selectedFoldLabel && (
              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                {selectedFoldLabel}
              </Badge>
            )}
            <span className="inline-flex items-center gap-1">
              <Layers className="h-3 w-3" />
              <span className="truncate max-w-[260px]" title={preprocessLabel}>
                {preprocessLabel}
              </span>
            </span>
            <Badge
              variant={prediction.pipeline_status === "completed" ? "default" : "secondary"}
              className="h-5 px-1.5 text-[10px]"
            >
              {prediction.pipeline_status || "unknown"}
            </Badge>
          </div>
        </div>
      </div>
    </header>
  );
}

interface ChainDetailFoldSummaryProps {
  selectedLabel: string;
  refitCount: number;
  cvViewCount: number;
  foldCount: number;
}

export function ChainDetailFoldSummary({
  selectedLabel,
  refitCount,
  cvViewCount,
  foldCount,
}: ChainDetailFoldSummaryProps) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/60 p-3 shadow-sm">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCell
          label="Selected"
          value={selectedLabel}
          className="border-primary/25 bg-primary/[0.06]"
        />
        <SummaryCell
          label="Refits"
          value={refitCount}
          className="border-emerald-500/25 bg-emerald-500/[0.06]"
        />
        <SummaryCell label="CV Views" value={cvViewCount} />
        <SummaryCell label="Folds" value={foldCount} />
      </div>
    </div>
  );
}

function SummaryCell({
  label,
  value,
  className,
}: {
  label: string;
  value: string | number;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-border/70 bg-background/65 px-3 py-2 ${className ?? ""}`}>
      <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-base font-semibold">{value}</div>
    </div>
  );
}
