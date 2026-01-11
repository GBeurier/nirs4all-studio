/**
 * ClassificationConfig - Configuration panel for with_classification() step
 */

import { Tags } from "lucide-react";
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
import type { SynthesisStepDefinition, SeparationMethod } from "../types";

interface ClassificationConfigProps {
  params: Record<string, unknown>;
  definition: SynthesisStepDefinition;
  onChange: (params: Record<string, unknown>) => void;
}

export function ClassificationConfig({
  params,
  definition,
  onChange,
}: ClassificationConfigProps) {
  const nClasses = (params.n_classes as number) || 2;
  const separation = (params.separation as number) || 1.5;
  const separationMethod = (params.separation_method as SeparationMethod) || "component";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-purple-500/10">
          <Tags className="h-4 w-4 text-purple-600" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">Classification Configuration</h3>
          <p className="text-xs text-muted-foreground">{definition.description}</p>
        </div>
      </div>

      <Separator />

      {/* Number of Classes */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Number of Classes</Label>
          <span className="text-sm font-medium">{nClasses}</span>
        </div>
        <Slider
          value={[nClasses]}
          min={2}
          max={20}
          step={1}
          onValueChange={(v) => onChange({ n_classes: v[0] })}
        />
        <p className="text-xs text-muted-foreground">
          Total number of discrete classes (2-20)
        </p>
      </div>

      {/* Class Separation */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Class Separation</Label>
          <span className="text-sm font-medium">{separation.toFixed(1)}</span>
        </div>
        <Slider
          value={[separation]}
          min={0.5}
          max={3.0}
          step={0.1}
          onValueChange={(v) => onChange({ separation: v[0] })}
        />
        <p className="text-xs text-muted-foreground">
          Higher values = more distinguishable classes
        </p>
      </div>

      {/* Separation Method */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Separation Method</Label>
        <Select
          value={separationMethod}
          onValueChange={(v) => onChange({ separation_method: v })}
        >
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="component">
              <div className="flex flex-col">
                <span>Component-based</span>
                <span className="text-xs text-muted-foreground">
                  Separate by chemical composition
                </span>
              </div>
            </SelectItem>
            <SelectItem value="threshold">
              <div className="flex flex-col">
                <span>Threshold-based</span>
                <span className="text-xs text-muted-foreground">
                  Threshold on concentration
                </span>
              </div>
            </SelectItem>
            <SelectItem value="cluster">
              <div className="flex flex-col">
                <span>Cluster-based</span>
                <span className="text-xs text-muted-foreground">
                  Cluster-based separation
                </span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
