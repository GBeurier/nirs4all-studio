import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  return (
    <div className="space-y-3 border-t pt-3">
      <SectionHeader>{t("predictions.viewer.config.points")}</SectionHeader>
      <SliderField
        label={t("predictions.viewer.config.pointSize")}
        valueLabel={`${config.pointSize}px`}
        value={config.pointSize}
        min={2}
        max={10}
        step={1}
        fallback={4}
        onValueChange={(value) => update("pointSize", value)}
      />
      <SliderField
        label={t("predictions.viewer.config.pointOpacity")}
        valueLabel={config.pointOpacity.toFixed(2)}
        value={config.pointOpacity}
        min={0.3}
        max={1}
        step={0.05}
        fallback={0.7}
        onValueChange={(value) => update("pointOpacity", value)}
      />
      <SwitchRow
        label={t("predictions.viewer.config.jitter")}
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
  const { t } = useTranslation();
  return (
    <div className="space-y-3 border-t pt-3">
      <SectionHeader>{t("predictions.viewer.config.scatter")}</SectionHeader>
      <SwitchRow
        label={t("predictions.viewer.config.identityLine")}
        checked={config.identityLine}
        onCheckedChange={(value) => update("identityLine", value)}
      />
      <SwitchRow
        label={t("predictions.viewer.config.regressionLine")}
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
  const { t } = useTranslation();
  return (
    <div className="space-y-3 border-t pt-3">
      <SectionHeader>{t("predictions.viewer.config.residuals")}</SectionHeader>
      <SwitchRow
        label={t("predictions.viewer.config.zeroLine")}
        checked={config.zeroLine}
        onCheckedChange={(value) => update("zeroLine", value)}
      />
      <SwitchRow
        label={t("predictions.viewer.config.sigmaBand")}
        checked={config.sigmaBand}
        onCheckedChange={(value) => update("sigmaBand", value)}
      />
    </div>
  );
}
