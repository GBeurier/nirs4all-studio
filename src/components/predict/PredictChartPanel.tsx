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

import { cn } from "@/lib/utils";

import { MetricsStrip } from "@/components/predictions/viewer/MetricsStrip";
import { PredictionColorLegend } from "@/components/predictions/viewer/PredictionColorLegend";
import { buildPredictionColoration } from "@/components/predictions/viewer/coloration";
import { shouldShowPredictionColorLegend } from "@/components/predictions/viewer/predictionViewerData";
import type {
  ChartConfig,
  ChartKind,
  PartitionDataset,
  TaskKind,
} from "@/components/predictions/viewer/types";
import { PredictChartPanelChartArea } from "./PredictChartPanelChartArea";
import { PredictChartPanelToolbar } from "./PredictChartPanelToolbar";

export type PanelKind = ChartKind;

interface PredictChartPanelProps {
  datasets: PartitionDataset[];
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

    const legendVisible = shouldShowPredictionColorLegend({
      colorMode: config.colorMode,
      datasetCount: datasets.length,
      kind,
      metadataKey: coloration.metadataKey,
    });

    const showMetricsStrip = hasActuals && kind !== "distribution";

    return (
      <div
        className={cn(
          "flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm",
          isFullscreen && "min-h-0 flex-1",
          className,
        )}
      >
        <PredictChartPanelToolbar
          availableKinds={availableKinds}
          canExport={datasets.length > 0}
          config={config}
          isFullscreen={isFullscreen}
          kind={kind}
          metadataColumns={coloration.metadataColumns}
          onConfigChange={onConfigChange}
          onConfigReset={onConfigReset}
          onExportCsv={onExportCsv}
          onExportPng={onExportPng}
          onExpand={onExpand}
          onKindChange={onKindChange}
          resolvedMetadataType={coloration.metadataType}
        />

        {legendVisible && (
          <div className="border-b bg-muted/10 px-3 py-1.5">
            <PredictionColorLegend datasets={datasets} config={config} />
          </div>
        )}

        <PredictChartPanelChartArea
          chartClassName={chartClassName}
          chartRef={chartRef}
          config={config}
          datasets={datasets}
          hasActuals={hasActuals}
          isFullscreen={isFullscreen}
          kind={kind}
          taskKind={taskKind}
        />

        {showMetricsStrip && (
          <MetricsStrip taskKind={taskKind} datasets={datasets} />
        )}
      </div>
    );
  },
);

export default PredictChartPanel;
