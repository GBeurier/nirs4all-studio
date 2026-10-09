/**
 * FinetuneSearchConfig - Trials, timeout, approach, eval_mode settings
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Info,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  Zap,
  Target,
  Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { FinetuneConfig } from "../types";

interface FinetuneSearchConfigProps {
  config: FinetuneConfig;
  onUpdate: (updates: Partial<FinetuneConfig>) => void;
}

export function FinetuneSearchConfig({
  config,
  onUpdate,
}: FinetuneSearchConfigProps) {
  const { t } = useTranslation();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const updateOptionalString = (
    key: "storage" | "study_name",
    value: string
  ) => {
    onUpdate({ [key]: value.length > 0 ? value : undefined });
  };

  return (
    <div className="space-y-4">
      {/* Primary settings - stack vertically for narrow panels */}
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label className="text-sm">{t("pipelineEditor.finetune.search.numberOfTrials")}</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-48">
                {t("pipelineEditor.finetune.search.numberOfTrialsHint")}
              </TooltipContent>
            </Tooltip>
          </div>
          <Input
            type="number"
            value={config.n_trials}
            onChange={(e) =>
              onUpdate({ n_trials: Math.max(1, parseInt(e.target.value) || 10) })
            }
            min={1}
            max={1000}
            className="font-mono"
          />
          <div className="flex flex-wrap gap-1">
            {[20, 50, 100, 200].map((n) => (
              <Button
                key={n}
                variant={config.n_trials === n ? "secondary" : "ghost"}
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => onUpdate({ n_trials: n })}
              >
                {n}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label className="text-sm">{t("pipelineEditor.finetune.search.timeout")}</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-48">
                {t("pipelineEditor.finetune.search.timeoutHint")}
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="relative">
            <Input
              type="number"
              value={config.timeout ?? ""}
              onChange={(e) =>
                onUpdate({
                  timeout: e.target.value
                    ? Math.max(60, parseInt(e.target.value))
                    : undefined,
                })
              }
              placeholder={t("pipelineEditor.finetune.search.noLimit")}
              min={60}
              className="font-mono pr-10"
            />
            <Timer className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex flex-wrap gap-1">
            {[
              { id: "1h", label: "1h", value: 3600 },
              { id: "2h", label: "2h", value: 7200 },
              { id: "none", label: t("common.none"), value: undefined },
            ].map((opt) => (
              <Button
                key={opt.id}
                variant={config.timeout === opt.value ? "secondary" : "ghost"}
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => onUpdate({ timeout: opt.value })}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Advanced settings */}
      <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-between h-8 text-muted-foreground"
          >
            <span className="text-xs">{t("pipelineEditor.finetune.search.advanced")}</span>
            {showAdvanced ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent className="pt-3 space-y-4">
          {/* Approach */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label className="text-sm">{t("pipelineEditor.finetune.search.approach")}</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-48">
                  <p className="font-medium">{t("pipelineEditor.finetune.search.grouped")}</p>
                  <p className="text-xs">{t("pipelineEditor.finetune.search.groupedHint")}</p>
                  <p className="font-medium mt-2">{t("pipelineEditor.finetune.search.individual")}</p>
                  <p className="text-xs">{t("pipelineEditor.finetune.search.individualHint")}</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <Select
              value={config.approach}
              onValueChange={(value: "grouped" | "individual") =>
                onUpdate({ approach: value })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="grouped">
                  <div className="flex items-center gap-2">
                    <Target className="h-4 w-4" />
                    <span>{t("pipelineEditor.finetune.search.grouped")}</span>
                  </div>
                </SelectItem>
                <SelectItem value="individual">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4" />
                    <span>{t("pipelineEditor.finetune.search.individual")}</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Evaluation mode */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label className="text-sm">{t("pipelineEditor.finetune.search.evalMode")}</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-48">
                  <p className="font-medium">{t("pipelineEditor.finetune.search.bestScore")}</p>
                  <p className="text-xs">{t("pipelineEditor.finetune.search.bestScoreHint")}</p>
                  <p className="font-medium mt-2">{t("pipelineEditor.finetune.search.meanScore")}</p>
                  <p className="text-xs">{t("pipelineEditor.finetune.search.meanScoreHint")}</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <Select
              value={config.eval_mode}
              onValueChange={(value: "best" | "mean") =>
                onUpdate({ eval_mode: value })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="best">{t("pipelineEditor.finetune.search.bestScore")}</SelectItem>
                <SelectItem value="mean">{t("pipelineEditor.finetune.search.meanScore")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Optimizer persistence */}
          <div className="space-y-3 rounded-lg border border-border/60 p-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label className="text-sm">{t("pipelineEditor.finetune.search.persistence")}</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64">
                    {t("pipelineEditor.finetune.search.persistenceTooltip")}
                  </TooltipContent>
                </Tooltip>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("pipelineEditor.finetune.search.persistenceHelp")}
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground" htmlFor="finetune-storage">
                {t("pipelineEditor.finetune.search.storageUri")}
              </Label>
              <Input
                id="finetune-storage"
                value={config.storage ?? ""}
                onChange={(event) => updateOptionalString("storage", event.target.value)}
                placeholder="sqlite:///optuna-study.db"
                className="font-mono"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground" htmlFor="finetune-study-name">
                {t("pipelineEditor.finetune.search.studyName")}
              </Label>
              <Input
                id="finetune-study-name"
                value={config.study_name ?? ""}
                onChange={(event) => updateOptionalString("study_name", event.target.value)}
                placeholder="pls-baseline-v1"
                className="font-mono"
              />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Info box */}
      <div className="flex items-start gap-2 p-3 rounded-lg bg-purple-500/5 border border-purple-500/20">
        <Lightbulb className="h-4 w-4 text-purple-500 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground">
          <p>
            {t("pipelineEditor.finetune.search.infoBox", { trials: config.n_trials })}
          </p>
        </div>
      </div>
    </div>
  );
}
