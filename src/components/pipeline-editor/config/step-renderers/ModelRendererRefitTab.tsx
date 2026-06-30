import {
  RefreshCcw,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { type PipelineStep, type RefitConfig } from "../../types";

interface ModelRefitTabProps {
  step: PipelineStep;
  onUpdate: (updates: Partial<PipelineStep>) => void;
}

export function ModelRefitTab({ step, onUpdate }: ModelRefitTabProps) {
  const config: RefitConfig = step.refitConfig ?? {
    enabled: true,
  };

  const handleToggle = (enabled: boolean) => {
    onUpdate({
      refitConfig: { ...config, enabled },
    });
  };

  const handleParamChange = (key: string, value: string) => {
    const parsed = parseFloat(value);
    const newParams = { ...(config.refit_params || {}) };
    if (value === "" || isNaN(parsed)) {
      delete newParams[key];
    } else {
      newParams[key] = parsed;
    }
    onUpdate({
      refitConfig: {
        ...config,
        refit_params: Object.keys(newParams).length > 0 ? newParams : undefined,
      },
    });
  };

  const handleRemoveParam = (key: string) => {
    const newParams = { ...(config.refit_params || {}) };
    delete newParams[key];
    onUpdate({
      refitConfig: {
        ...config,
        refit_params: Object.keys(newParams).length > 0 ? newParams : undefined,
      },
    });
  };

  const handleAddParam = () => {
    const newParams = { ...(config.refit_params || {}), "": 0 };
    onUpdate({
      refitConfig: { ...config, refit_params: newParams },
    });
  };

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium flex items-center gap-2">
            <RefreshCcw className="h-4 w-4" />
            Refit Configuration
          </Label>
          <Switch
            checked={config.enabled}
            onCheckedChange={handleToggle}
          />
        </div>

        <div className="p-3 rounded-lg bg-muted/30">
          <p className="text-xs text-muted-foreground">
            When enabled, the best model from cross-validation is retrained on the
            full training set to produce a deployment-ready "final model". The
            exported .n4a bundle will contain this refit model.
          </p>
        </div>
      </div>

      {config.enabled && (
        <>
          <Separator />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Parameter Overrides</Label>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={handleAddParam}
              >
                Add Override
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Override specific model parameters for the refit phase. For example,
              you can use more epochs or a lower learning rate when retraining on
              all data.
            </p>

            {config.refit_params && Object.keys(config.refit_params).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(config.refit_params).map(([key, value], index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      placeholder="Parameter name"
                      value={key}
                      onChange={(e) => {
                        const newParams = { ...(config.refit_params || {}) };
                        const oldValue = newParams[key];
                        delete newParams[key];
                        newParams[e.target.value] = oldValue;
                        onUpdate({
                          refitConfig: { ...config, refit_params: newParams },
                        });
                      }}
                      className="h-8 font-mono text-xs flex-1"
                    />
                    <Input
                      type="number"
                      placeholder="Value"
                      value={String(value ?? "")}
                      onChange={(e) => handleParamChange(key || `param_${index}`, e.target.value)}
                      className="h-8 font-mono text-xs w-24"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemoveParam(key)}
                    >
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-4 text-muted-foreground border border-dashed rounded-lg">
                <p className="text-xs">
                  No overrides configured. The refit model will use the same
                  parameters as the best CV model.
                </p>
              </div>
            )}
          </div>

          <Separator />

          <div className="space-y-2">
            <Label className="text-sm font-medium">Common Overrides</Label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "More Epochs", params: { epochs: 200 } },
                { label: "Lower LR", params: { learning_rate: 0.0001 } },
                { label: "No Early Stop", params: { patience: 999 } },
                { label: "Larger Batch", params: { batch_size: 64 } },
              ].map((preset) => (
                <Button
                  key={preset.label}
                  variant="outline"
                  size="sm"
                  className="h-auto py-1.5 justify-start text-left text-xs"
                  onClick={() => {
                    const newParams = {
                      ...(config.refit_params || {}),
                      ...preset.params,
                    };
                    onUpdate({
                      refitConfig: { ...config, refit_params: newParams },
                    });
                  }}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
