/**
 * NonlinearConfig - Configuration panel for with_nonlinear_targets() step
 */

import { useTranslation } from "react-i18next";
import { TrendingUp } from "lucide-react";
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
import type { SynthesisStepDefinition, InteractionType } from "../types";
import { getStepDescription } from "../definitionLabels";

interface NonlinearConfigProps {
  params: Record<string, unknown>;
  definition: SynthesisStepDefinition;
  onChange: (params: Record<string, unknown>) => void;
}

export function NonlinearConfig({
  params,
  definition,
  onChange,
}: NonlinearConfigProps) {
  const { t } = useTranslation();
  const interactions = (params.interactions as InteractionType) || "polynomial";
  const interactionStrength = (params.interaction_strength as number) ?? 0.5;
  const hiddenFactors = (params.hidden_factors as number) || 0;
  const polynomialDegree = (params.polynomial_degree as number) || 2;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-red-500/10">
          <TrendingUp className="h-4 w-4 text-red-600" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">{t("spectraSynthesis.config.nonlinear.title")}</h3>
          <p className="text-xs text-muted-foreground">{getStepDescription(t, definition.type)}</p>
        </div>
      </div>

      <Separator />

      {/* Interaction Type */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">{t("spectraSynthesis.config.nonlinear.type.label")}</Label>
        <Select
          value={interactions}
          onValueChange={(v) => onChange({ interactions: v })}
        >
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="polynomial">{t("spectraSynthesis.config.nonlinear.type.polynomial")}</SelectItem>
            <SelectItem value="synergistic">{t("spectraSynthesis.config.nonlinear.type.synergistic")}</SelectItem>
            <SelectItem value="antagonistic">{t("spectraSynthesis.config.nonlinear.type.antagonistic")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Interaction Strength */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">{t("spectraSynthesis.config.nonlinear.strength.label")}</Label>
          <span className="text-sm font-medium">{interactionStrength.toFixed(1)}</span>
        </div>
        <Slider
          value={[interactionStrength]}
          min={0}
          max={1}
          step={0.1}
          onValueChange={(v) => onChange({ interaction_strength: v[0] })}
        />
        <p className="text-xs text-muted-foreground">
          {t("spectraSynthesis.config.nonlinear.strength.hint")}
        </p>
      </div>

      {/* Hidden Factors */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">{t("spectraSynthesis.config.nonlinear.hidden.label")}</Label>
          <span className="text-sm font-medium">{hiddenFactors}</span>
        </div>
        <Slider
          value={[hiddenFactors]}
          min={0}
          max={5}
          step={1}
          onValueChange={(v) => onChange({ hidden_factors: v[0] })}
        />
        <p className="text-xs text-muted-foreground">
          {t("spectraSynthesis.config.nonlinear.hidden.hint")}
        </p>
      </div>

      {/* Polynomial Degree */}
      {interactions === "polynomial" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">{t("spectraSynthesis.config.nonlinear.degree.label")}</Label>
            <span className="text-sm font-medium">{polynomialDegree}</span>
          </div>
          <Slider
            value={[polynomialDegree]}
            min={2}
            max={5}
            step={1}
            onValueChange={(v) => onChange({ polynomial_degree: v[0] })}
          />
        </div>
      )}
    </div>
  );
}
