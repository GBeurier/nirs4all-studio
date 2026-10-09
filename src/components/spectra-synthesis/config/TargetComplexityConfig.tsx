/**
 * TargetComplexityConfig - Configuration panel for with_target_complexity() step
 */

import { useTranslation } from "react-i18next";
import { Shuffle } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import type { SynthesisStepDefinition } from "../types";
import { getStepDescription } from "../definitionLabels";

interface TargetComplexityConfigProps {
  params: Record<string, unknown>;
  definition: SynthesisStepDefinition;
  onChange: (params: Record<string, unknown>) => void;
}

export function TargetComplexityConfig({
  params,
  definition,
  onChange,
}: TargetComplexityConfigProps) {
  const { t } = useTranslation();
  const signalToConfoundRatio = (params.signal_to_confound_ratio as number) ?? 1.0;
  const nConfounders = (params.n_confounders as number) || 0;
  const spectralMasking = (params.spectral_masking as number) || 0;
  const temporalDrift = (params.temporal_drift as boolean) || false;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-indigo-500/10">
          <Shuffle className="h-4 w-4 text-indigo-600" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">{t("spectraSynthesis.config.targetComplexity.title")}</h3>
          <p className="text-xs text-muted-foreground">{getStepDescription(t, definition.type)}</p>
        </div>
      </div>

      <Separator />

      {/* Signal-to-Confound Ratio */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">{t("spectraSynthesis.config.targetComplexity.ratio.label")}</Label>
          <span className="text-sm font-medium">{(signalToConfoundRatio * 100).toFixed(0)}%</span>
        </div>
        <Slider
          value={[signalToConfoundRatio]}
          min={0}
          max={1}
          step={0.1}
          onValueChange={(v) => onChange({ signal_to_confound_ratio: v[0] })}
        />
        <p className="text-xs text-muted-foreground">
          {t("spectraSynthesis.config.targetComplexity.ratio.hint")}
        </p>
      </div>

      {/* Number of Confounders */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">{t("spectraSynthesis.config.targetComplexity.confounders.label")}</Label>
          <span className="text-sm font-medium">{nConfounders}</span>
        </div>
        <Slider
          value={[nConfounders]}
          min={0}
          max={5}
          step={1}
          onValueChange={(v) => onChange({ n_confounders: v[0] })}
        />
      </div>

      {/* Spectral Masking */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">{t("spectraSynthesis.config.targetComplexity.masking.label")}</Label>
          <span className="text-sm font-medium">{(spectralMasking * 100).toFixed(0)}%</span>
        </div>
        <Slider
          value={[spectralMasking]}
          min={0}
          max={1}
          step={0.1}
          onValueChange={(v) => onChange({ spectral_masking: v[0] })}
        />
        <p className="text-xs text-muted-foreground">
          {t("spectraSynthesis.config.targetComplexity.masking.hint")}
        </p>
      </div>

      {/* Temporal Drift */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">{t("spectraSynthesis.config.targetComplexity.drift.label")}</Label>
          <p className="text-xs text-muted-foreground">
            {t("spectraSynthesis.config.targetComplexity.drift.hint")}
          </p>
        </div>
        <Switch
          checked={temporalDrift}
          onCheckedChange={(v) => onChange({ temporal_drift: v })}
        />
      </div>
    </div>
  );
}
