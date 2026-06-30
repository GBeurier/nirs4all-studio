import {
  type ChartConfigUpdater,
  SectionHeader,
} from "./ChartConfigPopoverPrimitives";
import {
  SliderField,
  SwitchRow,
} from "./ChartConfigPopoverSectionControls";
import type { ChartConfig } from "./types";

export function PointsSection({
  config,
  update,
}: {
  config: ChartConfig;
  update: ChartConfigUpdater;
}) {
  return (
    <div className="space-y-3 border-t pt-3">
      <SectionHeader>Points</SectionHeader>
      <SliderField
        label="Size"
        valueLabel={`${config.pointSize}px`}
        value={config.pointSize}
        min={2}
        max={10}
        step={1}
        fallback={4}
        onValueChange={(value) => update("pointSize", value)}
      />
      <SliderField
        label="Opacity"
        valueLabel={config.pointOpacity.toFixed(2)}
        value={config.pointOpacity}
        min={0.3}
        max={1}
        step={0.05}
        fallback={0.7}
        onValueChange={(value) => update("pointOpacity", value)}
      />
      <SwitchRow
        label="Jitter discrete values"
        checked={config.jitter}
        onCheckedChange={(value) => update("jitter", value)}
      />
    </div>
  );
}

export function ScatterSection({
  config,
  update,
}: {
  config: ChartConfig;
  update: ChartConfigUpdater;
}) {
  return (
    <div className="space-y-3 border-t pt-3">
      <SectionHeader>Scatter</SectionHeader>
      <SwitchRow
        label="Identity line (y=x)"
        checked={config.identityLine}
        onCheckedChange={(value) => update("identityLine", value)}
      />
      <SwitchRow
        label="Regression line"
        checked={config.regressionLine}
        onCheckedChange={(value) => update("regressionLine", value)}
      />
    </div>
  );
}

export function ResidualsSection({
  config,
  update,
}: {
  config: ChartConfig;
  update: ChartConfigUpdater;
}) {
  return (
    <div className="space-y-3 border-t pt-3">
      <SectionHeader>Residuals</SectionHeader>
      <SwitchRow
        label="Zero line"
        checked={config.zeroLine}
        onCheckedChange={(value) => update("zeroLine", value)}
      />
      <SwitchRow
        label="Reference band (±1σ)"
        checked={config.sigmaBand}
        onCheckedChange={(value) => update("sigmaBand", value)}
      />
    </div>
  );
}
