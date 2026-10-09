/**
 * BatchEffectsConfig - Configuration panel for with_batch_effects() step
 */

import { useTranslation } from "react-i18next";
import { Layers } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import type { SynthesisStepDefinition } from "../types";
import { getStepDescription } from "../definitionLabels";

interface BatchEffectsConfigProps {
  params: Record<string, unknown>;
  definition: SynthesisStepDefinition;
  onChange: (params: Record<string, unknown>) => void;
}

export function BatchEffectsConfig({
  params,
  definition,
  onChange,
}: BatchEffectsConfigProps) {
  const { t } = useTranslation();
  const enabled = (params.enabled as boolean) ?? true;
  const nBatches = (params.n_batches as number) || 3;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-yellow-500/10">
          <Layers className="h-4 w-4 text-yellow-600" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">{t("spectraSynthesis.config.batchEffects.title")}</h3>
          <p className="text-xs text-muted-foreground">{getStepDescription(t, definition.type)}</p>
        </div>
      </div>

      <Separator />

      {/* Enable Batch Effects */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">{t("spectraSynthesis.config.batchEffects.enable.label")}</Label>
          <p className="text-xs text-muted-foreground">
            {t("spectraSynthesis.config.batchEffects.enable.hint")}
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(v) => onChange({ enabled: v })}
        />
      </div>

      {/* Number of Batches */}
      {enabled && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">{t("spectraSynthesis.config.batchEffects.nBatches.label")}</Label>
            <span className="text-sm font-medium">{nBatches}</span>
          </div>
          <Slider
            value={[nBatches]}
            min={2}
            max={20}
            step={1}
            onValueChange={(v) => onChange({ n_batches: v[0] })}
          />
          <p className="text-xs text-muted-foreground">
            {t("spectraSynthesis.config.batchEffects.nBatches.hint")}
          </p>
        </div>
      )}
    </div>
  );
}
