import { SelectItem } from "@/components/ui/select";
import {
  type ChartConfigUpdater,
  SectionHeader,
} from "./ChartConfigPopoverPrimitives";
import {
  SelectRow,
  SliderField,
  SwitchRow,
} from "./ChartConfigPopoverSectionControls";
import type {
  ChartConfig,
  HistogramLayout,
  HistogramSeries,
  HistogramYAxis,
} from "./types";

export function DistributionSection({
  config,
  update,
}: {
  config: ChartConfig;
  update: ChartConfigUpdater;
}) {
  return (
    <div className="space-y-3 border-t pt-3">
      <SectionHeader>Distribution</SectionHeader>
      <HistogramSeriesRow series={config.histogramSeries} update={update} />
      <HistogramLayoutRow layout={config.histogramLayout} update={update} />
      <HistogramYAxisRow yAxis={config.histogramYAxis} update={update} />
      <SliderField
        label="Bins"
        valueLabel={config.histogramBinCount}
        value={config.histogramBinCount}
        min={10}
        max={60}
        step={1}
        fallback={15}
        onValueChange={(value) => update("histogramBinCount", value)}
      />
      <SliderField
        label="Bar opacity"
        valueLabel={config.histogramBarOpacity.toFixed(2)}
        value={config.histogramBarOpacity}
        min={0.3}
        max={1}
        step={0.05}
        fallback={0.85}
        onValueChange={(value) => update("histogramBarOpacity", value)}
      />
      <SwitchRow
        label="Error bars (±√n)"
        checked={config.histogramShowErrorBars}
        onCheckedChange={(value) => update("histogramShowErrorBars", value)}
      />
      <SwitchRow
        label="Mean reference line"
        checked={config.histogramShowMean}
        onCheckedChange={(value) => update("histogramShowMean", value)}
      />
      <SwitchRow
        label="Median reference line"
        checked={config.histogramShowMedian}
        onCheckedChange={(value) => update("histogramShowMedian", value)}
      />
      <p className="text-[10px] leading-4 text-muted-foreground">
        Bins, density, and residuals apply to regression distributions. Classification uses discrete class labels.
      </p>
    </div>
  );
}

function HistogramSeriesRow({
  series,
  update,
}: {
  series: HistogramSeries;
  update: ChartConfigUpdater;
}) {
  return (
    <SelectRow
      label="Series"
      value={series}
      onValueChange={(value) => update("histogramSeries", value as HistogramSeries)}
    >
      <SelectItem value="both" className="text-xs">Actual + Predicted</SelectItem>
      <SelectItem value="predicted" className="text-xs">Predicted</SelectItem>
      <SelectItem value="actual" className="text-xs">Actual</SelectItem>
      <SelectItem value="residuals" className="text-xs">Residuals</SelectItem>
    </SelectRow>
  );
}

function HistogramLayoutRow({
  layout,
  update,
}: {
  layout: HistogramLayout;
  update: ChartConfigUpdater;
}) {
  return (
    <SelectRow
      label="Layout"
      value={layout}
      onValueChange={(value) => update("histogramLayout", value as HistogramLayout)}
    >
      <SelectItem value="grouped" className="text-xs">Grouped</SelectItem>
      <SelectItem value="stacked" className="text-xs">Stacked</SelectItem>
      <SelectItem value="overlaid" className="text-xs">Overlaid</SelectItem>
    </SelectRow>
  );
}

function HistogramYAxisRow({
  yAxis,
  update,
}: {
  yAxis: HistogramYAxis;
  update: ChartConfigUpdater;
}) {
  return (
    <SelectRow
      label="Y-axis"
      value={yAxis}
      onValueChange={(value) => update("histogramYAxis", value as HistogramYAxis)}
    >
      <SelectItem value="count" className="text-xs">Count</SelectItem>
      <SelectItem value="density" className="text-xs">Density</SelectItem>
    </SelectRow>
  );
}
