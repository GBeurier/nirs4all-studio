/**
 * Chart panel for the Predict page — feature-parity with the unified
 * prediction viewer used in outcomes pages (history, leaderboard, database),
 * but driven by data already held on the client (no fetch).
 *
 * Supports:
 *   - scatter (regression)
 *   - residuals (regression)
 *   - confusion matrix (classification)
 *   - distribution (regression → histogram, classification → class counts)
 *
 * Honors the shared ChartConfig (palette, point size/opacity, identity line,
 * regression line, jitter, zero line, sigma band, confusion normalization,
 * confusion gradient) so visuals match the viewer modal used elsewhere.
 */

import { forwardRef, useMemo } from "react";
import {
  Activity,
  BarChart3,
  FileSpreadsheet,
  Grid3x3,
  ImageDown,
  Maximize2,
  TrendingUp,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import { ChartConfigPopover } from "@/components/predictions/viewer/ChartConfigPopover";
import { MetricsStrip } from "@/components/predictions/viewer/MetricsStrip";
import { PredictionColorLegend } from "@/components/predictions/viewer/PredictionColorLegend";
import { PredictionScatterChart } from "@/components/predictions/viewer/charts/PredictionScatterChart";
import { PredictionResidualsChart } from "@/components/predictions/viewer/charts/PredictionResidualsChart";
import { PredictionConfusionChart } from "@/components/predictions/viewer/charts/PredictionConfusionChart";
import { PredictionHistogramChart } from "@/components/predictions/viewer/charts/PredictionHistogramChart";
import { buildPredictionColoration } from "@/components/predictions/viewer/coloration";
import type {
  ChartConfig,
  ChartKind,
  PartitionDataset,
  TaskKind,
  ViewerHeader,
} from "@/components/predictions/viewer/types";

export type PanelKind = ChartKind;

interface PredictChartPanelProps {
  datasets: PartitionDataset[];
  header: ViewerHeader;
  taskKind: TaskKind;
  hasActuals: boolean;
  availableKinds: PanelKind[];
  kind: PanelKind;
  onKindChange: (next: PanelKind) => void;
  config: ChartConfig;
  onConfigChange: (next: ChartConfig | ((prev: ChartConfig) => ChartConfig)) => void;
  onConfigReset: () => void;
  onExportPng: () => void;
  onExportCsv: () => void;
  onExpand?: () => void;
  isFullscreen?: boolean;
  className?: string;
  chartClassName?: string;
}

export const PredictChartPanel = forwardRef<HTMLDivElement, PredictChartPanelProps>(
  function PredictChartPanel(
    {
      datasets,
      header,
      taskKind,
      hasActuals,
      availableKinds,
      kind,
      onKindChange,
      config,
      onConfigChange,
      onConfigReset,
      onExportPng,
      onExportCsv,
      onExpand,
      isFullscreen,
      className,
      chartClassName,
    },
    chartRef,
  ) {
    const coloration = useMemo(
      () => buildPredictionColoration(datasets, config),
      [datasets, config],
    );

    const legendVisible =
      kind !== "confusion"
        && datasets.length > 0
        && (config.colorMode === "partition" || Boolean(coloration.metadataKey));

    const showMetricsStrip = hasActuals && kind !== "distribution";

    // Chart area sizing: full-screen fills the flex parent, inline mode uses a
    // fixed pixel height so Recharts' ResponsiveContainer gets a non-zero
    // clientHeight on first paint (flex-1 inside an auto-height column would
    // collapse to 0 and force a subsequent resize to render).
    const chartAreaClass = chartClassName
      ? cn("px-3 py-3", chartClassName)
      : isFullscreen
      ? "flex min-h-0 flex-1 flex-col px-3 py-3"
      : "h-[420px] shrink-0 px-3 py-3";

    return (
      <div
        className={cn(
          "flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm",
          isFullscreen && "min-h-0 flex-1",
          className,
        )}
      >
        {/* Toolbar row: chart-kind toggles on the left, config + exports on the right */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-3 py-2">
          <ToggleGroup
            type="single"
            size="sm"
            value={kind}
            onValueChange={(v) => {
              if (v && (availableKinds as string[]).includes(v)) {
                onKindChange(v as PanelKind);
              }
            }}
            className="justify-start"
          >
            {availableKinds.includes("scatter") && (
              <ToggleGroupItem value="scatter" className="h-8 gap-1.5 text-xs">
                <TrendingUp className="h-3.5 w-3.5" />
                Scatter
              </ToggleGroupItem>
            )}
            {availableKinds.includes("residuals") && (
              <ToggleGroupItem value="residuals" className="h-8 gap-1.5 text-xs">
                <BarChart3 className="h-3.5 w-3.5" />
                Residuals
              </ToggleGroupItem>
            )}
            {availableKinds.includes("confusion") && (
              <ToggleGroupItem value="confusion" className="h-8 gap-1.5 text-xs">
                <Grid3x3 className="h-3.5 w-3.5" />
                Confusion
              </ToggleGroupItem>
            )}
            {availableKinds.includes("distribution") && (
              <ToggleGroupItem value="distribution" className="h-8 gap-1.5 text-xs">
                <Activity className="h-3.5 w-3.5" />
                Distribution
              </ToggleGroupItem>
            )}
          </ToggleGroup>

          <div className="flex items-center gap-1.5">
            <ChartConfigPopover
              kind={kind as ChartKind}
              config={config}
              metadataColumns={coloration.metadataColumns}
              resolvedMetadataType={coloration.metadataType}
              onChange={onConfigChange}
              onReset={onConfigReset}
            />
            {onExpand && !isFullscreen && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={onExpand}
                title="Expand to full-screen viewer"
              >
                <Maximize2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Expand</span>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={onExportPng}
              disabled={datasets.length === 0}
              title="Export chart as PNG"
            >
              <ImageDown className="h-3.5 w-3.5" />
              PNG
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={onExportCsv}
              title="Export data as CSV"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              CSV
            </Button>
          </div>
        </div>

        {legendVisible && (
          <div className="border-b bg-muted/10 px-3 py-1.5">
            <PredictionColorLegend datasets={datasets} config={config} />
          </div>
        )}

        {/* Chart area — fixed pixel height inline, fill in fullscreen */}
        <div className={chartAreaClass}>
          {kind === "scatter" && hasActuals && datasets.length > 0 ? (
            <PredictionScatterChart
              ref={chartRef}
              datasets={datasets}
              config={config}
              variant="full"
            />
          ) : kind === "residuals" && hasActuals && datasets.length > 0 ? (
            <PredictionResidualsChart
              ref={chartRef}
              datasets={datasets}
              config={config}
              variant="full"
            />
          ) : kind === "confusion" && hasActuals && datasets.length > 0 ? (
            <PredictionConfusionChart
              ref={chartRef}
              datasets={datasets}
              config={config}
              variant="full"
            />
          ) : kind === "distribution" && datasets.length > 0 ? (
            <PredictionHistogramChart
              ref={chartRef}
              datasets={datasets}
              config={config}
              taskKind={taskKind}
              hasActuals={hasActuals}
              variant="full"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {hasActuals
                ? "No data to display for this view."
                : "Reference values are required for this chart. Switch to Distribution or predict on a dataset partition with targets."}
            </div>
          )}
        </div>

        {showMetricsStrip && (
          <MetricsStrip taskKind={taskKind} datasets={datasets} header={header} />
        )}
      </div>
    );
  },
);

export default PredictChartPanel;
