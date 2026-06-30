import type { ReactNode } from "react";
import {
  Activity,
  BarChart3,
  Grid3x3,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ChartKind,
  ViewerPartitionTarget,
} from "@/components/predictions/viewer/types";
import { ChartTile } from "./ChartTile";
import { PartitionLegend } from "./PartitionLegend";

interface ChainDetailChartPreviewProps {
  previewKind: ChartKind;
  onPreviewKindChange: (kind: ChartKind) => void;
  taskKind: "regression" | "classification";
  partitions: ViewerPartitionTarget[];
  selectedFoldLabel: string | null;
  selectedPartitionCount: number;
  canCustomize: boolean;
  onCustomize: (kind: ChartKind) => void;
  isViewerOpen?: boolean;
  children: ReactNode;
}

export function ChainDetailChartPreview({
  previewKind,
  onPreviewKindChange,
  taskKind,
  partitions,
  selectedFoldLabel,
  selectedPartitionCount,
  canCustomize,
  onCustomize,
  isViewerOpen,
  children,
}: ChainDetailChartPreviewProps) {
  const title = getChartPreviewTitle(previewKind);
  const icon = getChartPreviewIcon(previewKind);

  return (
    <section className="space-y-3">
      <div>
        <div className="text-sm font-semibold tracking-tight">Chart preview</div>
        <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
          {selectedFoldLabel
            ? `${selectedFoldLabel} · ${selectedPartitionCount} partition${selectedPartitionCount === 1 ? "" : "s"}`
            : "Select a related prediction to display its chart preview."}
        </div>
      </div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <PartitionLegend partitions={partitions} />
        <div className="inline-flex w-full rounded-xl border border-border/70 bg-card/50 p-1 lg:w-auto">
          {getChartPreviewOptions(taskKind).map((option) => (
            <button
              key={option.kind}
              type="button"
              onClick={() => onPreviewKindChange(option.kind)}
              className={cn(
                "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors lg:flex-none",
                previewKind === option.kind
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
              )}
            >
              {option.icon}
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <ChartTile
        title={title}
        icon={icon}
        subtitle={getChartPreviewSubtitle(previewKind)}
        onCustomize={canCustomize ? () => onCustomize(previewKind) : undefined}
        height="h-[380px] md:h-[420px] xl:h-[440px]"
        className="overflow-hidden"
      >
        {isViewerOpen ? (
          <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">
            Customizing in the full viewer - preview paused to avoid distracting updates.
          </div>
        ) : (
          children
        )}
      </ChartTile>
    </section>
  );
}

function getChartPreviewOptions(taskKind: "regression" | "classification") {
  return taskKind === "classification"
    ? [
        { kind: "confusion" as const, label: "Confusion", icon: <Grid3x3 className="h-3.5 w-3.5" /> },
        { kind: "distribution" as const, label: "Distribution", icon: <Activity className="h-3.5 w-3.5" /> },
      ]
    : [
        { kind: "scatter" as const, label: "Predicted vs Actual", icon: <TrendingUp className="h-3.5 w-3.5" /> },
        { kind: "residuals" as const, label: "Residuals", icon: <BarChart3 className="h-3.5 w-3.5" /> },
        { kind: "distribution" as const, label: "Distribution", icon: <Activity className="h-3.5 w-3.5" /> },
      ];
}

function getChartPreviewTitle(kind: ChartKind): string {
  if (kind === "confusion") return "Confusion matrix";
  if (kind === "residuals") return "Residuals";
  if (kind === "distribution") return "Distribution";
  return "Predicted vs Actual";
}

function getChartPreviewIcon(kind: ChartKind) {
  if (kind === "confusion") return <Grid3x3 className="h-3.5 w-3.5" />;
  if (kind === "residuals") return <BarChart3 className="h-3.5 w-3.5" />;
  if (kind === "distribution") return <Activity className="h-3.5 w-3.5" />;
  return <TrendingUp className="h-3.5 w-3.5" />;
}

function getChartPreviewSubtitle(kind: ChartKind): string {
  if (kind === "confusion") {
    return "Shared chart-view rendering without the configuration controls";
  }
  if (kind === "residuals") {
    return "Large preview of residual spread for the selected prediction";
  }
  if (kind === "distribution") {
    return "Histogram of predicted / actual / residual values for the selected prediction";
  }
  return "Large preview using the same chart-view styling";
}
