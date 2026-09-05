import type { Dispatch, SetStateAction } from "react";
import { Info } from "lucide-react";
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
  DEFAULT_N_CLASSES,
  isClassificationTask,
} from "./SyntheticDataDialogData";

interface SyntheticCustomConfigTabProps {
  config: GenerateSyntheticRequest;
  setConfig: Dispatch<SetStateAction<GenerateSyntheticRequest>>;
}

export function SyntheticCustomConfigTab({
  config,
  setConfig,
}: SyntheticCustomConfigTabProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-sm">Task Type</Label>
          <Select
            value={config.task_type}
            onValueChange={(value) =>
              setConfig((previous) => ({
                ...previous,
                task_type: value as GenerateSyntheticRequest["task_type"],
                n_classes:
                  value === "binary_classification"
                    ? 2
                    : value === "multiclass_classification"
                      ? 3
                      : undefined,
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
              setConfig((previous) => ({
                ...previous,
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
              setConfig((previous) => ({ ...previous, n_samples: value }))
            }
            min={50}
            max={5000}
            step={50}
            className="py-2"
          />
        </div>

        {isClassificationTask(config.task_type) && (
          <div className="space-y-2">
            <Label className="text-sm">Number of Classes</Label>
            <Input
              type="number"
              min={config.task_type === "binary_classification" ? 2 : 3}
              max={20}
              disabled={config.task_type === "binary_classification"}
              value={
                config.task_type === "binary_classification"
                  ? 2
                  : (config.n_classes ?? DEFAULT_N_CLASSES)
              }
              onChange={(event) =>
                setConfig((previous) => ({
                  ...previous,
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
              setConfig((previous) => ({
                ...previous,
                train_ratio: value / 100,
              }))
            }
            min={50}
            max={95}
            step={5}
            className="py-2"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 pt-4 border-t">
        <div className="space-y-2">
          <Label className="text-sm">Dataset Name (optional)</Label>
          <Input
            placeholder="Auto-generated if empty"
            value={config.name ?? ""}
            onChange={(event) =>
              setConfig((previous) => ({
                ...previous,
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
                setConfig((previous) => ({ ...previous, auto_link: value }))
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
