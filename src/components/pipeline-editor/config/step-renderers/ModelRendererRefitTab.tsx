import { useTranslation } from "react-i18next";
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

const REFIT_PRESETS = [
  { id: "moreEpochs", params: { epochs: 200 } },
  { id: "lowerLr", params: { learning_rate: 0.0001 } },
  { id: "noEarlyStop", params: { patience: 999 } },
  { id: "largerBatch", params: { batch_size: 64 } },
] as const;

export function ModelRefitTab({ step, onUpdate }: ModelRefitTabProps) {
  const { t } = useTranslation();
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
            {t("pipelineEditor.config.refit.title")}
          </Label>
          <Switch
            checked={config.enabled}
            onCheckedChange={handleToggle}
            aria-label={t("pipelineEditor.config.refit.title")}
          />
        </div>

        <div className="p-3 rounded-lg bg-muted/30">
          <p className="text-xs text-muted-foreground">
            {t("pipelineEditor.config.refit.description")}
          </p>
        </div>
      </div>

      {config.enabled && (
        <>
          <Separator />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">{t("pipelineEditor.config.refit.overrides")}</Label>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={handleAddParam}
              >
                {t("pipelineEditor.config.refit.addOverride")}
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              {t("pipelineEditor.config.refit.overridesHint")}
            </p>

            {config.refit_params && Object.keys(config.refit_params).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(config.refit_params).map(([key, value], index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      placeholder={t("pipelineEditor.config.refit.paramName")}
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
                      placeholder={t("pipelineEditor.config.refit.value")}
                      value={String(value ?? "")}
                      onChange={(e) => handleParamChange(key || `param_${index}`, e.target.value)}
                      className="h-8 font-mono text-xs w-24"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      aria-label={t("pipelineEditor.config.refit.removeOverride")}
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
                  {t("pipelineEditor.config.refit.noOverrides")}
                </p>
              </div>
            )}
          </div>

          <Separator />

          <div className="space-y-2">
            <Label className="text-sm font-medium">{t("pipelineEditor.config.refit.commonOverrides")}</Label>
            <div className="grid grid-cols-2 gap-2">
              {REFIT_PRESETS.map((preset) => (
                <Button
                  key={preset.id}
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
                  {t(`pipelineEditor.config.refit.preset.${preset.id}`)}
                </Button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
