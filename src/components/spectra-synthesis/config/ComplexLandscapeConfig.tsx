/**
 * ComplexLandscapeConfig - Configuration panel for with_complex_target_landscape() step
 */

import { useTranslation } from "react-i18next";
import { Mountain } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { SynthesisStepDefinition, RegimeMethod } from "../types";
import { getStepDescription } from "../definitionLabels";

interface ComplexLandscapeConfigProps {
  params: Record<string, unknown>;
  definition: SynthesisStepDefinition;
  onChange: (params: Record<string, unknown>) => void;
}

export function ComplexLandscapeConfig({
  params,
  definition,
  onChange,
}: ComplexLandscapeConfigProps) {
  const { t } = useTranslation();
  const nRegimes = (params.n_regimes as number) || 1;
  const regimeMethod = (params.regime_method as RegimeMethod) || "concentration";
  const regimeOverlap = (params.regime_overlap as number) ?? 0.2;
  const noiseHeteroscedasticity = (params.noise_heteroscedasticity as number) || 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/10">
          <Mountain className="h-4 w-4 text-emerald-600" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">{t("spectraSynthesis.config.complexLandscape.title")}</h3>
          <p className="text-xs text-muted-foreground">{getStepDescription(t, definition.type)}</p>
        </div>
      </div>

      <Separator />

      {/* Number of Regimes */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">{t("spectraSynthesis.config.complexLandscape.regimes.label")}</Label>
          <span className="text-sm font-medium">{nRegimes}</span>
        </div>
        <Slider
          value={[nRegimes]}
          min={1}
          max={10}
          step={1}
          onValueChange={(v) => onChange({ n_regimes: v[0] })}
        />
        <p className="text-xs text-muted-foreground">
          {t("spectraSynthesis.config.complexLandscape.regimes.hint")}
        </p>
      </div>

      {/* Regime Method */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">{t("spectraSynthesis.config.complexLandscape.assignment.label")}</Label>
        <Select
          value={regimeMethod}
          onValueChange={(v) => onChange({ regime_method: v })}
        >
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="concentration">{t("spectraSynthesis.config.complexLandscape.assignment.concentration")}</SelectItem>
            <SelectItem value="spectral">{t("spectraSynthesis.config.complexLandscape.assignment.spectral")}</SelectItem>
            <SelectItem value="random">{t("spectraSynthesis.config.complexLandscape.assignment.random")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Regime Overlap */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">{t("spectraSynthesis.config.complexLandscape.overlap.label")}</Label>
          <span className="text-sm font-medium">{regimeOverlap.toFixed(2)}</span>
        </div>
        <Slider
          value={[regimeOverlap]}
          min={0}
          max={0.5}
          step={0.05}
          onValueChange={(v) => onChange({ regime_overlap: v[0] })}
        />
        <p className="text-xs text-muted-foreground">
          {t("spectraSynthesis.config.complexLandscape.overlap.hint")}
        </p>
      </div>

      {/* Noise Heteroscedasticity */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">{t("spectraSynthesis.config.complexLandscape.hetero.label")}</Label>
          <span className="text-sm font-medium">{(noiseHeteroscedasticity * 100).toFixed(0)}%</span>
        </div>
        <Slider
          value={[noiseHeteroscedasticity]}
          min={0}
          max={1}
          step={0.1}
          onValueChange={(v) => onChange({ noise_heteroscedasticity: v[0] })}
        />
        <p className="text-xs text-muted-foreground">
          {t("spectraSynthesis.config.complexLandscape.hetero.hint")}
        </p>
      </div>
    </div>
  );
}
