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
  getConfusionGradientLabel,
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
  return (
    <div className="space-y-3 border-t pt-3">
      <SectionHeader>Confusion matrix</SectionHeader>
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
        label="Show row/col totals"
        checked={config.confusionShowTotals}
        onCheckedChange={(value) => update("confusionShowTotals", value)}
      />
      <SwitchRow
        label="Show count + %"
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
  return (
    <SelectRow
      label="Normalization"
      value={normalize}
      onValueChange={(value) => update("confusionNormalize", value as ConfusionNormalize)}
    >
      <SelectItem value="none" className="text-xs">Counts</SelectItem>
      <SelectItem value="row" className="text-xs">Row %</SelectItem>
      <SelectItem value="col" className="text-xs">Column %</SelectItem>
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
  return (
    <SelectField
      label="Gradient preset"
      value={preset}
      onValueChange={applyConfusionGradientPreset}
      triggerContent={<ConfusionGradientPreview gradient={gradient} label={getConfusionGradientLabel(preset)} truncate />}
      footer={(
        <p className="text-[10px] leading-4 text-muted-foreground">
          Presets seed the gradient, then you can fine-tune the low and high stops for the matrix.
        </p>
      )}
    >
      {listConfusionGradients().map((option) => (
        <SelectItem key={option.id} value={option.id} className="text-xs">
          <ConfusionGradientPreview gradient={option.colors} label={option.label} />
        </SelectItem>
      ))}
      <SelectItem value="custom" className="text-xs">
        <ConfusionGradientPreview gradient={gradient} label="Custom" />
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
  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
      <ColorInputRow
        label="Low cells"
        value={gradient.low}
        onChange={(value) => updateConfusionGradient("low", value)}
      />
      <ColorInputRow
        label="High cells"
        value={gradient.high}
        onChange={(value) => updateConfusionGradient("high", value)}
      />
    </div>
  );
}
