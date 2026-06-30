/**
 * Gear-icon popover hosting the prediction-chart configuration.
 *
 * Sections shown depend on the currently active ChartKind:
 *  - Global: always
 *  - Scatter / Residuals: regression kinds
 *  - Confusion: classification kind
 *
 * This component owns the config-update callbacks and the high-level
 * composition; each visible section is a render-only component in
 * `ChartConfigPopoverSections`.
 */

import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  applyChartConfigColorModeChange,
  applyChartConfigConfusionGradientColorChange,
  applyChartConfigConfusionGradientPreset,
  applyChartConfigMetadataKeyChange,
  applyChartConfigPartitionColorChange,
  applyChartConfigPartitionPalette,
  getCurrentPartitionPaletteColors,
  resolveChartConfigMetadata,
} from "./ChartConfigPopoverData";
import {
  ConfusionSection,
  DistributionSection,
  GlobalSection,
  PointsSection,
  ResidualsSection,
  ScatterSection,
} from "./ChartConfigPopoverSections";
import type {
  ChartConfig,
  ChartKind,
  ViewerGradientColors,
  ViewerMetadataType,
} from "./types";

interface ChartConfigPopoverProps {
  kind: ChartKind;
  config: ChartConfig;
  metadataColumns: string[];
  resolvedMetadataType: ViewerMetadataType | null;
  onChange: (next: ChartConfig | ((prev: ChartConfig) => ChartConfig)) => void;
  onReset: () => void;
}

export function ChartConfigPopover({
  kind,
  config,
  metadataColumns,
  resolvedMetadataType,
  onChange,
  onReset,
}: ChartConfigPopoverProps) {
  const update = <K extends keyof ChartConfig>(key: K, value: ChartConfig[K]) => {
    onChange((prev) => ({ ...prev, [key]: value }));
  };

  const {
    hasMetadata,
    effectiveMetadataKey,
    effectiveMetadataType,
  } = resolveChartConfigMetadata(config, metadataColumns, resolvedMetadataType);
  const currentPaletteColors = getCurrentPartitionPaletteColors(config);

  const applyPartitionPalette = (value: string) => {
    onChange((prev) => applyChartConfigPartitionPalette(prev, value));
  };

  const updatePartitionColor = (key: keyof ChartConfig["partitionColors"], value: string) => {
    onChange((prev) => applyChartConfigPartitionColorChange(prev, key, value));
  };

  const updateColorMode = (value: string) => {
    onChange((prev) => applyChartConfigColorModeChange(prev, value, metadataColumns));
  };

  const updateMetadataKey = (value: string) => {
    onChange((prev) => applyChartConfigMetadataKeyChange(prev, value));
  };

  const applyConfusionGradientPreset = (value: string) => {
    onChange((prev) => applyChartConfigConfusionGradientPreset(prev, value));
  };

  const updateConfusionGradient = (key: keyof ViewerGradientColors, value: string) => {
    onChange((prev) => applyChartConfigConfusionGradientColorChange(prev, key, value));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5">
          <Settings2 className="h-3.5 w-3.5" />
          <span className="text-xs">Configure</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[23rem] space-y-4 p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Chart settings</div>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onReset}>
            Reset
          </Button>
        </div>

        <GlobalSection
          kind={kind}
          config={config}
          metadataColumns={metadataColumns}
          hasMetadata={hasMetadata}
          effectiveMetadataKey={effectiveMetadataKey}
          effectiveMetadataType={effectiveMetadataType}
          currentPaletteColors={currentPaletteColors}
          update={update}
          updateColorMode={updateColorMode}
          updateMetadataKey={updateMetadataKey}
          applyPartitionPalette={applyPartitionPalette}
          updatePartitionColor={updatePartitionColor}
        />

        {(kind === "scatter" || kind === "residuals") && (
          <PointsSection config={config} update={update} />
        )}

        {kind === "scatter" && <ScatterSection config={config} update={update} />}

        {kind === "residuals" && <ResidualsSection config={config} update={update} />}

        {kind === "distribution" && <DistributionSection config={config} update={update} />}

        {kind === "confusion" && (
          <ConfusionSection
            config={config}
            update={update}
            applyConfusionGradientPreset={applyConfusionGradientPreset}
            updateConfusionGradient={updateConfusionGradient}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
