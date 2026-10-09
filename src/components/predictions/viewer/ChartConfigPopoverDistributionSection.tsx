import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  return (
    <div className="space-y-3 border-t pt-3">
      <SectionHeader>{t("predictions.viewer.config.distribution.title")}</SectionHeader>
      <HistogramSeriesRow series={config.histogramSeries} update={update} />
      <HistogramLayoutRow layout={config.histogramLayout} update={update} />
      <HistogramYAxisRow yAxis={config.histogramYAxis} update={update} />
      <SliderField
        label={t("predictions.viewer.config.distribution.bins")}
        valueLabel={config.histogramBinCount}
        value={config.histogramBinCount}
        min={10}
        max={60}
        step={1}
        fallback={15}
        onValueChange={(value) => update("histogramBinCount", value)}
      />
      <SliderField
        label={t("predictions.viewer.config.distribution.barOpacity")}
        valueLabel={config.histogramBarOpacity.toFixed(2)}
        value={config.histogramBarOpacity}
        min={0.3}
        max={1}
        step={0.05}
        fallback={0.85}
        onValueChange={(value) => update("histogramBarOpacity", value)}
      />
      <SwitchRow
        label={t("predictions.viewer.config.distribution.errorBars")}
        checked={config.histogramShowErrorBars}
        onCheckedChange={(value) => update("histogramShowErrorBars", value)}
      />
      <SwitchRow
        label={t("predictions.viewer.config.distribution.meanLine")}
        checked={config.histogramShowMean}
        onCheckedChange={(value) => update("histogramShowMean", value)}
      />
      <SwitchRow
        label={t("predictions.viewer.config.distribution.medianLine")}
        checked={config.histogramShowMedian}
        onCheckedChange={(value) => update("histogramShowMedian", value)}
      />
      <p className="text-[10px] leading-4 text-muted-foreground">
        {t("predictions.viewer.config.distribution.note")}
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
  const { t } = useTranslation();
  return (
    <SelectRow
      label={t("predictions.viewer.config.distribution.series")}
      value={series}
      onValueChange={(value) => update("histogramSeries", value as HistogramSeries)}
    >
      <SelectItem value="both" className="text-xs">{t("predictions.viewer.config.distribution.seriesBoth")}</SelectItem>
      <SelectItem value="predicted" className="text-xs">{t("predictions.viewer.config.distribution.seriesPredicted")}</SelectItem>
      <SelectItem value="actual" className="text-xs">{t("predictions.viewer.config.distribution.seriesActual")}</SelectItem>
      <SelectItem value="residuals" className="text-xs">{t("predictions.viewer.config.distribution.seriesResiduals")}</SelectItem>
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
  const { t } = useTranslation();
  return (
    <SelectRow
      label={t("predictions.viewer.config.distribution.layout")}
      value={layout}
      onValueChange={(value) => update("histogramLayout", value as HistogramLayout)}
    >
      <SelectItem value="grouped" className="text-xs">{t("predictions.viewer.config.distribution.layoutGrouped")}</SelectItem>
      <SelectItem value="stacked" className="text-xs">{t("predictions.viewer.config.distribution.layoutStacked")}</SelectItem>
      <SelectItem value="overlaid" className="text-xs">{t("predictions.viewer.config.distribution.layoutOverlaid")}</SelectItem>
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
  const { t } = useTranslation();
  return (
    <SelectRow
      label={t("predictions.viewer.config.distribution.yAxis")}
      value={yAxis}
      onValueChange={(value) => update("histogramYAxis", value as HistogramYAxis)}
    >
      <SelectItem value="count" className="text-xs">{t("predictions.viewer.config.distribution.yCount")}</SelectItem>
      <SelectItem value="density" className="text-xs">{t("predictions.viewer.config.distribution.yDensity")}</SelectItem>
    </SelectRow>
  );
}
