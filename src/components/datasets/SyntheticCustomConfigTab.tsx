import type { Dispatch, SetStateAction } from "react";
import { ChevronDown, ChevronUp, Info, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { GenerateSyntheticRequest } from "@/types/settings";
import {
  coerceIntInput,
  DEFAULT_N_BATCHES,
  DEFAULT_N_CLASSES,
  DEFAULT_REPETITIONS_PER_SAMPLE,
  isClassificationTask,
} from "./SyntheticDataDialogData";

interface SyntheticCustomConfigTabProps {
  config: GenerateSyntheticRequest;
  setConfig: Dispatch<SetStateAction<GenerateSyntheticRequest>>;
  showAdvanced: boolean;
  onShowAdvancedChange: (showAdvanced: boolean) => void;
}

export function SyntheticCustomConfigTab({
  config,
  setConfig,
  showAdvanced,
  onShowAdvancedChange,
}: SyntheticCustomConfigTabProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-sm">Task Type</Label>
          <Select
            value={config.task_type}
            onValueChange={(value) =>
              setConfig((prev) => ({
                ...prev,
                task_type: value as GenerateSyntheticRequest["task_type"],
              }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="regression">Regression</SelectItem>
              <SelectItem value="binary_classification">
                Binary Classification
              </SelectItem>
              <SelectItem value="multiclass_classification">
                Multiclass Classification
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-sm">Complexity</Label>
          <Select
            value={config.complexity}
            onValueChange={(value) =>
              setConfig((prev) => ({
                ...prev,
                complexity: value as GenerateSyntheticRequest["complexity"],
              }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="simple">Simple (fast training)</SelectItem>
              <SelectItem value="realistic">Realistic</SelectItem>
              <SelectItem value="complex">Complex (challenging)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between">
            <Label className="text-sm">Number of Samples</Label>
            <span className="text-xs text-muted-foreground">
              {config.n_samples}
            </span>
          </div>
          <Slider
            value={[config.n_samples]}
            onValueChange={([value]) =>
              setConfig((prev) => ({ ...prev, n_samples: value }))
            }
            min={100}
            max={5000}
            step={100}
            className="py-2"
          />
        </div>

        {isClassificationTask(config.task_type) && (
          <div className="space-y-2">
            <Label className="text-sm">Number of Classes</Label>
            <Input
              type="number"
              min={2}
              max={20}
              value={config.n_classes ?? DEFAULT_N_CLASSES}
              onChange={(event) =>
                setConfig((prev) => ({
                  ...prev,
                  n_classes: coerceIntInput(
                    event.target.value,
                    DEFAULT_N_CLASSES,
                  ),
                }))
              }
            />
          </div>
        )}

        <div className="space-y-2">
          <div className="flex justify-between">
            <Label className="text-sm">Train Ratio</Label>
            <span className="text-xs text-muted-foreground">
              {((config.train_ratio ?? 0.8) * 100).toFixed(0)}%
            </span>
          </div>
          <Slider
            value={[(config.train_ratio ?? 0.8) * 100]}
            onValueChange={([value]) =>
              setConfig((prev) => ({ ...prev, train_ratio: value / 100 }))
            }
            min={50}
            max={95}
            step={5}
            className="py-2"
          />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between">
            <Label className="text-sm">Noise Level</Label>
            <span className="text-xs text-muted-foreground">
              {((config.noise_level ?? 0.05) * 100).toFixed(0)}%
            </span>
          </div>
          <Slider
            value={[(config.noise_level ?? 0.05) * 100]}
            onValueChange={([value]) =>
              setConfig((prev) => ({ ...prev, noise_level: value / 100 }))
            }
            min={0}
            max={50}
            step={5}
            className="py-2"
          />
        </div>
      </div>

      <Collapsible open={showAdvanced} onOpenChange={onShowAdvancedChange}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full justify-between">
            <span className="flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              Advanced Options
            </span>
            {showAdvanced ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div className="space-y-0.5">
                <Label className="text-sm">Include Metadata</Label>
                <p className="text-xs text-muted-foreground">
                  Add sample_id, batch columns
                </p>
              </div>
              <Switch
                checked={config.include_metadata ?? true}
                onCheckedChange={(value) =>
                  setConfig((prev) => ({ ...prev, include_metadata: value }))
                }
              />
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div className="space-y-0.5">
                <Label className="text-sm">Batch Effects</Label>
                <p className="text-xs text-muted-foreground">
                  Simulate batch-to-batch variation
                </p>
              </div>
              <Switch
                checked={config.add_batch_effects ?? false}
                onCheckedChange={(value) =>
                  setConfig((prev) => ({ ...prev, add_batch_effects: value }))
                }
              />
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div className="space-y-0.5">
                <Label className="text-sm">Include Repetitions</Label>
                <p className="text-xs text-muted-foreground">
                  Duplicate samples with variation
                </p>
              </div>
              <Switch
                checked={config.include_repetitions ?? false}
                onCheckedChange={(value) =>
                  setConfig((prev) => ({ ...prev, include_repetitions: value }))
                }
              />
            </div>

            {config.include_repetitions && (
              <div className="space-y-2">
                <Label className="text-sm">Repetitions per Sample</Label>
                <Input
                  type="number"
                  min={2}
                  max={10}
                  value={
                    config.repetitions_per_sample ??
                    DEFAULT_REPETITIONS_PER_SAMPLE
                  }
                  onChange={(event) =>
                    setConfig((prev) => ({
                      ...prev,
                      repetitions_per_sample: coerceIntInput(
                        event.target.value,
                        DEFAULT_REPETITIONS_PER_SAMPLE,
                      ),
                    }))
                  }
                />
              </div>
            )}

            {config.add_batch_effects && (
              <div className="space-y-2">
                <Label className="text-sm">Number of Batches</Label>
                <Input
                  type="number"
                  min={2}
                  max={10}
                  value={config.n_batches ?? DEFAULT_N_BATCHES}
                  onChange={(event) =>
                    setConfig((prev) => ({
                      ...prev,
                      n_batches: coerceIntInput(
                        event.target.value,
                        DEFAULT_N_BATCHES,
                      ),
                    }))
                  }
                />
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      <div className="grid grid-cols-2 gap-4 pt-4 border-t">
        <div className="space-y-2">
          <Label className="text-sm">Dataset Name (optional)</Label>
          <Input
            placeholder="Auto-generated if empty"
            value={config.name ?? ""}
            onChange={(event) =>
              setConfig((prev) => ({
                ...prev,
                name: event.target.value || undefined,
              }))
            }
          />
        </div>
        <div className="flex items-end">
          <div className="flex items-center gap-2">
            <Switch
              id="auto-link-custom"
              checked={config.auto_link ?? true}
              onCheckedChange={(value) =>
                setConfig((prev) => ({ ...prev, auto_link: value }))
              }
            />
            <Label htmlFor="auto-link-custom" className="text-sm">
              Auto-link to workspace
            </Label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="h-3.5 w-3.5 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs">
                    Automatically add the generated dataset to your workspace
                    for immediate use.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </div>
    </div>
  );
}
