/**
 * PartitionsConfig - Configuration panel for with_partitions() step
 */

import { useTranslation } from "react-i18next";
import { Split } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import type { SynthesisStepDefinition } from "../types";
import { getStepDescription } from "../definitionLabels";

interface PartitionsConfigProps {
  params: Record<string, unknown>;
  definition: SynthesisStepDefinition;
  onChange: (params: Record<string, unknown>) => void;
}

export function PartitionsConfig({
  params,
  definition,
  onChange,
}: PartitionsConfigProps) {
  const { t } = useTranslation();
  const trainRatio = (params.train_ratio as number) || 0.8;
  const stratify = (params.stratify as boolean) || false;
  const shuffle = (params.shuffle as boolean) ?? true;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-cyan-500/10">
          <Split className="h-4 w-4 text-cyan-600" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">{t("spectraSynthesis.config.partitions.title")}</h3>
          <p className="text-xs text-muted-foreground">{getStepDescription(t, definition.type)}</p>
        </div>
      </div>

      <Separator />

      {/* Train Ratio */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">{t("spectraSynthesis.config.partitions.trainRatio")}</Label>
          <span className="text-sm font-medium">{(trainRatio * 100).toFixed(0)}%</span>
        </div>
        <Slider
          value={[trainRatio]}
          min={0.1}
          max={0.99}
          step={0.05}
          onValueChange={(v) => onChange({ train_ratio: v[0] })}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{t("spectraSynthesis.config.partitions.train", { percent: (trainRatio * 100).toFixed(0) })}</span>
          <span>{t("spectraSynthesis.config.partitions.test", { percent: ((1 - trainRatio) * 100).toFixed(0) })}</span>
        </div>
      </div>

      {/* Stratify */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">{t("spectraSynthesis.config.partitions.stratify.label")}</Label>
          <p className="text-xs text-muted-foreground">
            {t("spectraSynthesis.config.partitions.stratify.hint")}
          </p>
        </div>
        <Switch
          checked={stratify}
          onCheckedChange={(v) => onChange({ stratify: v })}
        />
      </div>

      {/* Shuffle */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">{t("spectraSynthesis.config.partitions.shuffle.label")}</Label>
          <p className="text-xs text-muted-foreground">
            {t("spectraSynthesis.config.partitions.shuffle.hint")}
          </p>
        </div>
        <Switch
          checked={shuffle}
          onCheckedChange={(v) => onChange({ shuffle: v })}
        />
      </div>
    </div>
  );
}
