import type { ReactNode } from "react";
import {
  Activity,
  BarChart3,
  Grid3x3,
  TrendingUp,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { cn } from "@/lib/utils";
import type {
  ChartKind,
  ChartConfig,
  ViewerPartitionTarget,
} from "@/components/predictions/viewer/types";
import { ChartTile } from "./ChartTile";
import { PartitionLegend } from "./PartitionLegend";

interface ChainDetailChartPreviewProps {
  previewKind: ChartKind;
  onPreviewKindChange: (kind: ChartKind) => void;
  taskKind: "regression" | "classification";
  partitions: ViewerPartitionTarget[];
  config?: Pick<ChartConfig, "palette" | "partitionColors">;
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
  config,
  selectedFoldLabel,
  selectedPartitionCount,
  canCustomize,
  onCustomize,
  isViewerOpen,
  children,
}: ChainDetailChartPreviewProps) {
  const { t } = useTranslation();
  const title = getChartPreviewTitle(previewKind, t);
  const icon = getChartPreviewIcon(previewKind);

  return (
    <section className="space-y-3">
      <div>
        <div className="text-sm font-semibold tracking-tight">{t("predictions.detail.chart.previewTitle")}</div>
        <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
          {selectedFoldLabel
            ? t("predictions.detail.chart.previewSelection", { fold: selectedFoldLabel, count: selectedPartitionCount })
            : t("predictions.detail.chart.selectRelatedPreview")}
        </div>
      </div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <PartitionLegend partitions={partitions} config={config} />
        <div className="inline-flex w-full rounded-xl border border-border/70 bg-card/50 p-1 lg:w-auto">
          {getChartPreviewOptions(taskKind, t).map((option) => (
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
        subtitle={t(`predictions.detail.chart.subtitle.${previewKind}`)}
        onCustomize={canCustomize ? () => onCustomize(previewKind) : undefined}
        height="h-[380px] md:h-[420px] xl:h-[440px]"
        className="overflow-hidden"
      >
        {isViewerOpen ? (
          <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">
            {t("predictions.detail.chart.viewerOpen")}
          </div>
        ) : (
          children
        )}
      </ChartTile>
    </section>
  );
}

function getChartPreviewOptions(taskKind: "regression" | "classification", t: TFunction) {
  return taskKind === "classification"
    ? [
        { kind: "confusion" as const, label: t("predictions.charts.kinds.confusion"), icon: <Grid3x3 className="h-3.5 w-3.5" /> },
        { kind: "distribution" as const, label: t("predictions.charts.kinds.distribution"), icon: <Activity className="h-3.5 w-3.5" /> },
      ]
    : [
        { kind: "scatter" as const, label: t("predictions.charts.kinds.scatter"), icon: <TrendingUp className="h-3.5 w-3.5" /> },
        { kind: "residuals" as const, label: t("predictions.charts.kinds.residuals"), icon: <BarChart3 className="h-3.5 w-3.5" /> },
        { kind: "distribution" as const, label: t("predictions.charts.kinds.distribution"), icon: <Activity className="h-3.5 w-3.5" /> },
      ];
}

function getChartPreviewTitle(kind: ChartKind, t: TFunction): string {
  if (kind === "confusion") return t("predictions.charts.titles.confusion");
  return t(`predictions.charts.kinds.${kind}`);
}

function getChartPreviewIcon(kind: ChartKind) {
  if (kind === "confusion") return <Grid3x3 className="h-3.5 w-3.5" />;
  if (kind === "residuals") return <BarChart3 className="h-3.5 w-3.5" />;
  if (kind === "distribution") return <Activity className="h-3.5 w-3.5" />;
  return <TrendingUp className="h-3.5 w-3.5" />;
}
