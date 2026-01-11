/**
 * MetadataConfig - Configuration panel for with_metadata() step
 */

import { FileText } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import type { SynthesisStepDefinition } from "../types";

interface MetadataConfigProps {
  params: Record<string, unknown>;
  definition: SynthesisStepDefinition;
  onChange: (params: Record<string, unknown>) => void;
}

export function MetadataConfig({
  params,
  definition,
  onChange,
}: MetadataConfigProps) {
  const sampleIds = (params.sample_ids as boolean) ?? true;
  const sampleIdPrefix = (params.sample_id_prefix as string) || "sample";
  const nGroups = params.n_groups as number | null;
  const nRepetitions = (params.n_repetitions as number) || 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-orange-500/10">
          <FileText className="h-4 w-4 text-orange-600" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">Metadata Configuration</h3>
          <p className="text-xs text-muted-foreground">{definition.description}</p>
        </div>
      </div>

      <Separator />

      {/* Generate Sample IDs */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">Generate Sample IDs</Label>
          <p className="text-xs text-muted-foreground">
            Generate unique sample identifiers
          </p>
        </div>
        <Switch
          checked={sampleIds}
          onCheckedChange={(v) => onChange({ sample_ids: v })}
        />
      </div>

      {/* Sample ID Prefix */}
      {sampleIds && (
        <div className="space-y-2">
          <Label className="text-sm font-medium">Sample ID Prefix</Label>
          <Input
            value={sampleIdPrefix}
            onChange={(e) => onChange({ sample_id_prefix: e.target.value })}
            placeholder="sample"
            className="h-8 text-sm"
          />
          <p className="text-xs text-muted-foreground">
            e.g., "{sampleIdPrefix}_001", "{sampleIdPrefix}_002"
          </p>
        </div>
      )}

      {/* Number of Groups */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Number of Groups (optional)</Label>
        <Input
          type="number"
          value={nGroups ?? ""}
          onChange={(e) =>
            onChange({
              n_groups: e.target.value === "" ? null : parseInt(e.target.value),
            })
          }
          placeholder="None"
          min={2}
          max={100}
          className="h-8 text-sm"
        />
        <p className="text-xs text-muted-foreground">
          For grouped cross-validation
        </p>
      </div>

      {/* Repetitions */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Repetitions per Sample</Label>
        <Input
          type="number"
          value={nRepetitions}
          onChange={(e) =>
            onChange({ n_repetitions: parseInt(e.target.value) || 1 })
          }
          min={1}
          max={10}
          className="h-8 text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Number of spectral repetitions per sample
        </p>
      </div>
    </div>
  );
}
