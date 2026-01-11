/**
 * TargetsConfig - Configuration panel for with_targets() step
 */

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
          <h3 className="text-sm font-semibold">Targets Configuration</h3>
          <p className="text-xs text-muted-foreground">{definition.description}</p>
        </div>
      </div>

      <Separator />

      {/* Distribution */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Distribution</Label>
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
                <span>Dirichlet</span>
                <span className="text-xs text-muted-foreground">
                  Compositional (sum to ~1)
                </span>
              </div>
            </SelectItem>
            <SelectItem value="uniform">
              <div className="flex flex-col">
                <span>Uniform</span>
                <span className="text-xs text-muted-foreground">
                  Independent [0,1] values
                </span>
              </div>
            </SelectItem>
            <SelectItem value="lognormal">
              <div className="flex flex-col">
                <span>Log-normal</span>
                <span className="text-xs text-muted-foreground">
                  Right-skewed distribution
                </span>
              </div>
            </SelectItem>
            <SelectItem value="correlated">
              <div className="flex flex-col">
                <span>Correlated</span>
                <span className="text-xs text-muted-foreground">
                  With specified correlations
                </span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Target Range */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Target Range</Label>
        <div className="flex gap-2">
          <div className="flex-1">
            <Label className="text-xs">Min</Label>
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
            <Label className="text-xs">Max</Label>
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
          Scale target values to this range
        </p>
      </div>

      {/* Target Component */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Target Component</Label>
        <Select
          value={component || "_null_"}
          onValueChange={(v) => onChange({ component: v === "_null_" ? null : v })}
        >
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Select component" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_null_">
              <span className="text-muted-foreground">None (multi-output)</span>
            </SelectItem>
            {availableComponents.map((comp) => (
              <SelectItem key={comp} value={comp}>
                {comp}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Use specific component as target, or multi-output for all
        </p>
      </div>

      {/* Transform */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Transform</Label>
        <Select
          value={transform || "_null_"}
          onValueChange={(v) => onChange({ transform: v === "_null_" ? null : v })}
        >
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_null_">None</SelectItem>
            <SelectItem value="log">Log</SelectItem>
            <SelectItem value="sqrt">Square Root</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Apply transformation to target values
        </p>
      </div>
    </div>
  );
}
