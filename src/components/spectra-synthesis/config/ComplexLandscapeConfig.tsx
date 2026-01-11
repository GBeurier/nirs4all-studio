/**
 * ComplexLandscapeConfig - Configuration panel for with_complex_target_landscape() step
 */

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
          <h3 className="text-sm font-semibold">Complex Landscape</h3>
          <p className="text-xs text-muted-foreground">{definition.description}</p>
        </div>
      </div>

      <Separator />

      {/* Number of Regimes */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Number of Regimes</Label>
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
          Number of different relationship subpopulations
        </p>
      </div>

      {/* Regime Method */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Regime Assignment</Label>
        <Select
          value={regimeMethod}
          onValueChange={(v) => onChange({ regime_method: v })}
        >
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="concentration">Concentration-based</SelectItem>
            <SelectItem value="spectral">Spectral-based</SelectItem>
            <SelectItem value="random">Random</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Regime Overlap */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Regime Overlap</Label>
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
          0 = hard boundaries, 0.5 = smooth transitions
        </p>
      </div>

      {/* Noise Heteroscedasticity */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Noise Heteroscedasticity</Label>
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
          How much noise varies by regime (0 = constant noise)
        </p>
      </div>
    </div>
  );
}
