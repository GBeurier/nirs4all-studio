import { Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { PipelineConfig } from "@/hooks/usePipelineEditor";

interface PipelineEditorSettingsPopoverProps {
  pipelineConfig: PipelineConfig;
  onPipelineConfigChange: (config: PipelineConfig) => void;
}

export function PipelineEditorSettingsPopover({
  pipelineConfig,
  onPipelineConfigChange,
}: PipelineEditorSettingsPopoverProps) {
  const { t } = useTranslation();
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("pipelineEditor.shell.settings.title")}
              className={pipelineConfig.seed !== undefined ? "text-primary" : ""}
            >
              <Settings className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("pipelineEditor.shell.settings.title")}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-72 bg-popover">
        <div className="space-y-4">
          <h4 className="text-sm font-medium">{t("pipelineEditor.shell.settings.title")}</h4>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="global-seed" className="text-xs text-muted-foreground">
                {t("pipelineEditor.shell.settings.globalSeed")}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="global-seed"
                  type="number"
                  placeholder={t("pipelineEditor.shell.settings.random")}
                  value={pipelineConfig.seed ?? ""}
                  onChange={(e) => {
                    const value = e.target.value;
                    onPipelineConfigChange({
                      ...pipelineConfig,
                      seed: value === "" ? undefined : parseInt(value, 10),
                    });
                  }}
                  className="h-8 text-sm"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onPipelineConfigChange({
                      ...pipelineConfig,
                      seed: Math.floor(Math.random() * 10000),
                    });
                  }}
                  className="h-8 px-2"
                >
                  {t("pipelineEditor.shell.settings.generate")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("pipelineEditor.shell.settings.seedHint")}
              </p>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
