/**
 * ChartRenderer - Chart step configuration renderer
 *
 * Renderer for chart visualization steps.
 *
 * Phase 3 Implementation - Component Refactoring
 * @see docs/_internals/implementation_roadmap.md
 */

import { useTranslation } from "react-i18next";
import { LineChart, Info } from "lucide-react";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StepActions } from "./StepActions";
import type { StepRendererProps } from "./types";

/**
 * ChartRenderer - Chart visualization configuration
 */
export function ChartRenderer({
  step,
  onUpdate,
  onRemove,
  onDuplicate,
}: StepRendererProps) {
  const { t } = useTranslation();
  const config = step.chartConfig;

  const handleChartTypeChange = (chartType: string) => {
    onUpdate(step.id, {
      params: { ...step.params, chartType },
      chartConfig: config
        ? { ...config, chartType: chartType as "chart_2d" | "chart_y" }
        : { chartType: chartType as "chart_2d" | "chart_y" },
    });
  };

  const handleOptionChange = (key: string, value: boolean) => {
    onUpdate(step.id, {
      chartConfig: config
        ? { ...config, [key]: value }
        : { chartType: "chart_2d", [key]: value },
    });
  };

  return (
    <>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-sky-500/10 border border-sky-500/30">
            <LineChart className="h-5 w-5 text-sky-500" />
            <div>
              <h4 className="font-medium text-sm">{t("pipelineEditor.config.chart.title")}</h4>
              <p className="text-xs text-muted-foreground">
                {t("pipelineEditor.config.chart.subtitle")}
              </p>
            </div>
          </div>

          {/* Chart Type */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">{t("pipelineEditor.config.chart.typeLabel")}</Label>
            <Select
              value={step.name || config?.chartType || "chart_2d"}
              onValueChange={handleChartTypeChange}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="chart_2d">
                  {t("pipelineEditor.config.chart.chart2d")}
                </SelectItem>
                <SelectItem value="chart_y">
                  {t("pipelineEditor.config.chart.chartY")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* Options */}
          <div className="space-y-4">
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2">
                <Label className="text-sm">{t("pipelineEditor.config.chart.includeExcluded")}</Label>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </div>
              <Switch
                checked={Boolean(config?.include_excluded)}
                aria-label={t("pipelineEditor.config.chart.includeExcluded")}
                onCheckedChange={(v) =>
                  handleOptionChange("include_excluded", v)
                }
              />
            </div>

            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2">
                <Label className="text-sm">{t("pipelineEditor.config.chart.highlightExcluded")}</Label>
              </div>
              <Switch
                checked={Boolean(config?.highlight_excluded)}
                aria-label={t("pipelineEditor.config.chart.highlightExcluded")}
                onCheckedChange={(v) =>
                  handleOptionChange("highlight_excluded", v)
                }
              />
            </div>
          </div>
        </div>
      </ScrollArea>

      <StepActions
        stepId={step.id}
        onDuplicate={onDuplicate}
        onRemove={onRemove}
      />
    </>
  );
}
