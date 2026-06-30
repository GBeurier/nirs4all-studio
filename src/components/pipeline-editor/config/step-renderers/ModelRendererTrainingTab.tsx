import { GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type PipelineStep, type TrainingConfig } from "../../types";
import { useSelectWheel } from "../../shared/useSelectWheel";

const DEFAULT_TRAINING_CONFIG: TrainingConfig = {
  epochs: 100,
  batch_size: 32,
  learning_rate: 0.001,
  patience: 20,
  optimizer: "adam",
};

const OPTIMIZER_OPTIONS: Array<{ value: NonNullable<TrainingConfig["optimizer"]> }> = [
  { value: "adam" },
  { value: "sgd" },
  { value: "rmsprop" },
  { value: "adamw" },
];

interface ModelTrainingTabProps {
  step: PipelineStep;
  onUpdate: (updates: Partial<PipelineStep>) => void;
}

export function ModelTrainingTab({ step, onUpdate }: ModelTrainingTabProps) {
  const config = step.trainingConfig ?? DEFAULT_TRAINING_CONFIG;

  const handleUpdate = (updates: Partial<TrainingConfig>) => {
    onUpdate({
      trainingConfig: { ...config, ...updates },
    });
  };

  const handleOptimizerWheel = useSelectWheel(
    config.optimizer ?? "adam",
    (v) => handleUpdate({ optimizer: v }),
    OPTIMIZER_OPTIONS,
    true
  );

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-4">
        <Label className="text-sm font-medium flex items-center gap-2">
          <GraduationCap className="h-4 w-4" />
          Training Configuration
        </Label>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Epochs</Label>
              <Input
                type="number"
                value={config.epochs}
                onChange={(e) =>
                  handleUpdate({ epochs: parseInt(e.target.value) || 100 })
                }
                min={1}
                className="font-mono h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Batch Size</Label>
              <Input
                type="number"
                value={config.batch_size}
                onChange={(e) =>
                  handleUpdate({ batch_size: parseInt(e.target.value) || 32 })
                }
                min={1}
                className="font-mono h-8"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Learning Rate
              </Label>
              <Input
                type="number"
                value={config.learning_rate}
                onChange={(e) =>
                  handleUpdate({
                    learning_rate: parseFloat(e.target.value) || 0.001,
                  })
                }
                step={0.0001}
                min={0.00001}
                className="font-mono h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Patience
              </Label>
              <Input
                type="number"
                value={config.patience ?? 20}
                onChange={(e) =>
                  handleUpdate({ patience: parseInt(e.target.value) || 20 })
                }
                min={1}
                className="font-mono h-8"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Optimizer</Label>
            <div onWheel={handleOptimizerWheel}>
              <Select
                value={config.optimizer}
                onValueChange={(value: "adam" | "sgd" | "rmsprop" | "adamw") =>
                  handleUpdate({ optimizer: value })
                }
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover">
                  <SelectItem value="adam">Adam</SelectItem>
                  <SelectItem value="adamw">AdamW</SelectItem>
                  <SelectItem value="sgd">SGD</SelectItem>
                  <SelectItem value="rmsprop">RMSprop</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>

      <Separator />

      <div className="space-y-2">
        <Label className="text-sm font-medium">Quick Presets</Label>
        <div className="grid grid-cols-2 gap-2">
          {[
            {
              label: "Quick",
              epochs: 20,
              batch: 64,
              lr: 0.01,
              patience: 5,
            },
            {
              label: "Standard",
              epochs: 100,
              batch: 32,
              lr: 0.001,
              patience: 20,
            },
            {
              label: "Long",
              epochs: 500,
              batch: 16,
              lr: 0.0001,
              patience: 50,
            },
            {
              label: "Fine-tune",
              epochs: 50,
              batch: 32,
              lr: 0.00001,
              patience: 10,
            },
          ].map((preset) => (
            <Button
              key={preset.label}
              variant="outline"
              size="sm"
              className="h-auto py-1.5 justify-start text-left"
              onClick={() =>
                handleUpdate({
                  epochs: preset.epochs,
                  batch_size: preset.batch,
                  learning_rate: preset.lr,
                  patience: preset.patience,
                })
              }
            >
              <div>
                <div className="font-medium text-xs">{preset.label}</div>
                <div className="text-[10px] text-muted-foreground">
                  {preset.epochs}ep, lr={preset.lr}
                </div>
              </div>
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
