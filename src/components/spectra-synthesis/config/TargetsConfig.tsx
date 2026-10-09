/**
 * TargetsConfig - Configuration panel for with_targets() step
 */

import { useTranslation } from "react-i18next";
import { Target } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useSynthesisBuilder } from "../contexts";
import type { SynthesisStepDefinition, Distribution, TargetTransform } from "../types";
import { getComponentLabel, getStepDescription } from "../definitionLabels";

interface TargetsConfigProps {
  params: Record<string, unknown>;
  definition: SynthesisStepDefinition;
  onChange: (params: Record<string, unknown>) => void;
}

export function TargetsConfig({
  params,
  definition,
  onChange,
}: TargetsConfigProps) {
  const { t } = useTranslation();
  const { state } = useSynthesisBuilder();

  const distribution = (params.distribution as Distribution) || "dirichlet";
  const range = (params.range as [number, number]) || [0, 100];
  const component = params.component as string | null;
  const transform = params.transform as TargetTransform;

  // Get components from features step if present
  const featuresStep = state.steps.find((s) => s.type === "features");
  const availableComponents = (featuresStep?.params.components as string[]) || ["water", "protein", "lipid"];

  const handleRangeChange = (values: number[]) => {
    onChange({ range: [values[0], values[1]] });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-green-500/10">
          <Target className="h-4 w-4 text-green-600" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">{t("spectraSynthesis.config.targets.title")}</h3>
          <p className="text-xs text-muted-foreground">{getStepDescription(t, definition.type)}</p>
        </div>
      </div>

      <Separator />

      {/* Distribution */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">{t("spectraSynthesis.config.targets.distribution.label")}</Label>
        <Select
          value={distribution}
          onValueChange={(v) => onChange({ distribution: v })}
        >
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="dirichlet">
              <div className="flex flex-col">
                <span>{t("spectraSynthesis.config.targets.distribution.dirichlet.name")}</span>
                <span className="text-xs text-muted-foreground">
                  {t("spectraSynthesis.config.targets.distribution.dirichlet.description")}
                </span>
              </div>
            </SelectItem>
            <SelectItem value="uniform">
              <div className="flex flex-col">
                <span>{t("spectraSynthesis.config.targets.distribution.uniform.name")}</span>
                <span className="text-xs text-muted-foreground">
                  {t("spectraSynthesis.config.targets.distribution.uniform.description")}
                </span>
              </div>
            </SelectItem>
            <SelectItem value="lognormal">
              <div className="flex flex-col">
                <span>{t("spectraSynthesis.config.targets.distribution.lognormal.name")}</span>
                <span className="text-xs text-muted-foreground">
                  {t("spectraSynthesis.config.targets.distribution.lognormal.description")}
                </span>
              </div>
            </SelectItem>
            <SelectItem value="correlated">
              <div className="flex flex-col">
                <span>{t("spectraSynthesis.config.targets.distribution.correlated.name")}</span>
                <span className="text-xs text-muted-foreground">
                  {t("spectraSynthesis.config.targets.distribution.correlated.description")}
                </span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Target Range */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">{t("spectraSynthesis.config.targets.range.label")}</Label>
        <div className="flex gap-2">
          <div className="flex-1">
            <Label className="text-xs">{t("spectraSynthesis.config.targets.range.min")}</Label>
            <Input
              type="number"
              value={range[0]}
              onChange={(e) =>
                handleRangeChange([parseFloat(e.target.value) || 0, range[1]])
              }
              className="h-8 text-sm"
            />
          </div>
          <div className="flex-1">
            <Label className="text-xs">{t("spectraSynthesis.config.targets.range.max")}</Label>
            <Input
              type="number"
              value={range[1]}
              onChange={(e) =>
                handleRangeChange([range[0], parseFloat(e.target.value) || 100])
              }
              className="h-8 text-sm"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("spectraSynthesis.config.targets.range.hint")}
        </p>
      </div>

      {/* Target Component */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">{t("spectraSynthesis.config.targets.component.label")}</Label>
        <Select
          value={component || "_null_"}
          onValueChange={(v) => onChange({ component: v === "_null_" ? null : v })}
        >
          <SelectTrigger className="h-9">
            <SelectValue placeholder={t("spectraSynthesis.config.targets.component.placeholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_null_">
              <span className="text-muted-foreground">{t("spectraSynthesis.config.targets.component.none")}</span>
            </SelectItem>
            {availableComponents.map((comp) => (
              <SelectItem key={comp} value={comp}>
                {getComponentLabel(t, comp)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {t("spectraSynthesis.config.targets.component.hint")}
        </p>
      </div>

      {/* Transform */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">{t("spectraSynthesis.config.targets.transform.label")}</Label>
        <Select
          value={transform || "_null_"}
          onValueChange={(v) => onChange({ transform: v === "_null_" ? null : v })}
        >
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_null_">{t("spectraSynthesis.config.targets.transform.none")}</SelectItem>
            <SelectItem value="log">{t("spectraSynthesis.config.targets.transform.log")}</SelectItem>
            <SelectItem value="sqrt">{t("spectraSynthesis.config.targets.transform.sqrt")}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {t("spectraSynthesis.config.targets.transform.hint")}
        </p>
      </div>
    </div>
  );
}
