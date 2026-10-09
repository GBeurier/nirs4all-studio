import { useTranslation } from "react-i18next";
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

const TRAINING_PRESETS = [
  { id: "quick", epochs: 20, batch: 64, lr: 0.01, patience: 5 },
  { id: "standard", epochs: 100, batch: 32, lr: 0.001, patience: 20 },
  { id: "long", epochs: 500, batch: 16, lr: 0.0001, patience: 50 },
  { id: "fineTune", epochs: 50, batch: 32, lr: 0.00001, patience: 10 },
] as const;

export function ModelTrainingTab({ step, onUpdate }: ModelTrainingTabProps) {
  const { t } = useTranslation();
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
          {t("pipelineEditor.config.training.title")}
        </Label>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("pipelineEditor.config.training.epochs")}</Label>
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
              <Label className="text-xs text-muted-foreground">{t("pipelineEditor.config.training.batchSize")}</Label>
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
                {t("pipelineEditor.config.training.learningRate")}
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
                {t("pipelineEditor.config.training.patience")}
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
            <Label className="text-xs text-muted-foreground">{t("pipelineEditor.config.training.optimizer")}</Label>
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
        <Label className="text-sm font-medium">{t("pipelineEditor.config.training.presets")}</Label>
        <div className="grid grid-cols-2 gap-2">
          {TRAINING_PRESETS.map((preset) => (
            <Button
              key={preset.id}
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
                <div className="font-medium text-xs">{t(`pipelineEditor.config.training.preset.${preset.id}`)}</div>
                <div className="text-[10px] text-muted-foreground">
                  {t("pipelineEditor.config.training.presetSummary", { epochs: preset.epochs, lr: preset.lr })}
                </div>
              </div>
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
