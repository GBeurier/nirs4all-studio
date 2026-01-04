/**
 * FinetuneSearchConfig - Trials, timeout, approach, eval_mode settings
 */

import { useState } from "react";
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
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="space-y-4">
      {/* Primary settings */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label className="text-sm">Number of Trials</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-[200px]">
                How many configurations Optuna will try. More trials = better
                results but longer runtime.
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
          <div className="flex gap-1">
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
            <Label className="text-sm">Timeout (seconds)</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-[200px]">
                Maximum time for optimization. Leave empty for no limit.
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
              placeholder="No limit"
              min={60}
              className="font-mono pr-10"
            />
            <Timer className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex gap-1">
            {[
              { label: "1h", value: 3600 },
              { label: "2h", value: 7200 },
              { label: "No limit", value: undefined },
            ].map((opt) => (
              <Button
                key={opt.label}
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
            <span className="text-xs">Advanced Settings</span>
            {showAdvanced ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent className="pt-3">
          <div className="grid grid-cols-2 gap-4">
            {/* Approach */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label className="text-sm">Optimization Approach</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[220px]">
                    <p className="font-medium">Grouped</p>
                    <p className="text-xs">
                      Same parameters for all CV folds (faster)
                    </p>
                    <p className="font-medium mt-2">Individual</p>
                    <p className="text-xs">
                      Different parameters per fold (more flexible)
                    </p>
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
                      <span>Grouped (recommended)</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="individual">
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4" />
                      <span>Individual</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Evaluation mode */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label className="text-sm">Evaluation Mode</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[220px]">
                    <p className="font-medium">Best Score</p>
                    <p className="text-xs">
                      Use the best fold score to guide search
                    </p>
                    <p className="font-medium mt-2">Mean Score</p>
                    <p className="text-xs">
                      Use average across folds (more robust)
                    </p>
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
                  <SelectItem value="best">Best Score</SelectItem>
                  <SelectItem value="mean">Mean Score (robust)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Info box */}
      <div className="flex items-start gap-2 p-3 rounded-lg bg-purple-500/5 border border-purple-500/20">
        <Lightbulb className="h-4 w-4 text-purple-500 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground">
          <p>
            Optuna uses Bayesian optimization to intelligently explore the
            parameter space. It will typically find good solutions in ~
            {config.n_trials} trials rather than exhaustively testing all
            combinations.
          </p>
        </div>
      </div>
    </div>
  );
}
