import { useTranslation } from "react-i18next";

import { SelectItem } from "@/components/ui/select";
import {
  ColorInputRow,
  MiniGradientBar,
  type ChartConfigUpdater,
  SectionHeader,
} from "./ChartConfigPopoverPrimitives";
import {
  SelectField,
  SelectRow,
  SwitchRow,
} from "./ChartConfigPopoverSectionControls";
import {
  getConfusionGradientLabelKey,
  listConfusionGradients,
} from "./palettes";
import type {
  ChartConfig,
  ConfusionNormalize,
  ViewerGradientColors,
} from "./types";
import type { ConfusionGradientColorKey } from "./ChartConfigPopoverData";

export function ConfusionSection({
  config,
  update,
  applyConfusionGradientPreset,
  updateConfusionGradient,
}: {
  config: ChartConfig;
  update: ChartConfigUpdater;
  applyConfusionGradientPreset: (value: string) => void;
  updateConfusionGradient: (key: ConfusionGradientColorKey, value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 border-t pt-3">
      <SectionHeader>{t("predictions.viewer.config.confusion.title")}</SectionHeader>
      <NormalizeRow normalize={config.confusionNormalize} update={update} />
      <ConfusionGradientField
        preset={config.confusionGradientPreset}
        gradient={config.confusionGradient}
        applyConfusionGradientPreset={applyConfusionGradientPreset}
      />
      <ConfusionGradientColorInputs
        gradient={config.confusionGradient}
        updateConfusionGradient={updateConfusionGradient}
      />
      <SwitchRow
        label={t("predictions.viewer.config.confusion.showTotals")}
        checked={config.confusionShowTotals}
        onCheckedChange={(value) => update("confusionShowTotals", value)}
      />
      <SwitchRow
        label={t("predictions.viewer.config.confusion.showPercent")}
        checked={config.confusionShowPercent}
        onCheckedChange={(value) => update("confusionShowPercent", value)}
      />
    </div>
  );
}

function NormalizeRow({
  normalize,
  update,
}: {
  normalize: ConfusionNormalize;
  update: ChartConfigUpdater;
}) {
  const { t } = useTranslation();
  return (
    <SelectRow
      label={t("predictions.viewer.config.confusion.normalization")}
      value={normalize}
      onValueChange={(value) => update("confusionNormalize", value as ConfusionNormalize)}
    >
      <SelectItem value="none" className="text-xs">{t("predictions.viewer.config.confusion.counts")}</SelectItem>
      <SelectItem value="row" className="text-xs">{t("predictions.viewer.config.confusion.rowPercent")}</SelectItem>
      <SelectItem value="col" className="text-xs">{t("predictions.viewer.config.confusion.columnPercent")}</SelectItem>
    </SelectRow>
  );
}

function ConfusionGradientField({
  preset,
  gradient,
  applyConfusionGradientPreset,
}: {
  preset: ChartConfig["confusionGradientPreset"];
  gradient: ViewerGradientColors;
  applyConfusionGradientPreset: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <SelectField
      label={t("predictions.viewer.config.confusion.gradientPreset")}
      value={preset}
      onValueChange={applyConfusionGradientPreset}
      triggerContent={<ConfusionGradientPreview gradient={gradient} label={t(getConfusionGradientLabelKey(preset))} truncate />}
      footer={(
        <p className="text-[10px] leading-4 text-muted-foreground">
          {t("predictions.viewer.config.confusion.gradientHelp")}
        </p>
      )}
    >
      {listConfusionGradients().map((option) => (
        <SelectItem key={option.id} value={option.id} className="text-xs">
          <ConfusionGradientPreview gradient={option.colors} label={t(option.labelKey)} />
        </SelectItem>
      ))}
      <SelectItem value="custom" className="text-xs">
        <ConfusionGradientPreview gradient={gradient} label={t("common.custom")} />
      </SelectItem>
    </SelectField>
  );
}

function ConfusionGradientPreview({
  gradient,
  label,
  truncate = false,
}: {
  gradient: ViewerGradientColors;
  label: string;
  truncate?: boolean;
}) {
  return (
    <div className={truncate ? "flex min-w-0 items-center gap-2" : "flex items-center gap-2"}>
      <MiniGradientBar gradient={gradient} />
      <span className={truncate ? "truncate" : undefined}>{label}</span>
    </div>
  );
}

function ConfusionGradientColorInputs({
  gradient,
  updateConfusionGradient,
}: {
  gradient: ViewerGradientColors;
  updateConfusionGradient: (key: ConfusionGradientColorKey, value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
      <ColorInputRow
        label={t("predictions.viewer.config.confusion.lowCells")}
        value={gradient.low}
        onChange={(value) => updateConfusionGradient("low", value)}
      />
      <ColorInputRow
        label={t("predictions.viewer.config.confusion.highCells")}
        value={gradient.high}
        onChange={(value) => updateConfusionGradient("high", value)}
      />
    </div>
  );
}
