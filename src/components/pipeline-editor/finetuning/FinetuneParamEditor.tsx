/**
 * FinetuneParamEditor - Individual parameter search space configuration
 */

import { useState, useMemo } from "react";
import {
  Trash2,
  Info,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { FinetuneParamConfig, FinetuneParamType } from "../types";
import { formatParamType, getParamTypeIcon } from "./types";

interface FinetuneParamEditorProps {
  param: FinetuneParamConfig;
  onUpdate: (updates: Partial<FinetuneParamConfig>) => void;
  onRemove: () => void;
  existingParams: string[];
  modelName: string;
}

export function FinetuneParamEditor({
  param,
  onUpdate,
  onRemove,
  existingParams,
  modelName,
}: FinetuneParamEditorProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const TypeIcon = getParamTypeIcon(param.type);

  // Validation
  const validationError = useMemo(() => {
    if (param.type === "categorical") {
      if (!param.choices || param.choices.length < 2) {
        return "At least 2 choices required";
      }
    } else {
      if (param.low === undefined || param.high === undefined) {
        return "Low and high values required";
      }
      if (param.low >= param.high) {
        return "Low must be less than high";
      }
      if (param.type === "log_float" && param.low <= 0) {
        return "Log scale requires positive values";
      }
    }
    return null;
  }, [param]);

  // Format search space for display
  const searchSpaceDisplay = useMemo(() => {
    if (param.type === "categorical") {
      return param.choices?.join(", ") ?? "";
    }
    const stepStr = param.step ? `, step=${param.step}` : "";
    const scaleStr = param.type === "log_float" ? " (log)" : "";
    return `[${param.low}, ${param.high}${stepStr}]${scaleStr}`;
  }, [param]);

  return (
    <div
      className={cn(
        "rounded-lg border transition-all",
        validationError
          ? "border-destructive/50 bg-destructive/5"
          : "border-purple-500/30 bg-purple-500/5"
      )}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <TypeIcon className="h-4 w-4 text-purple-500" />
          <span className="font-medium text-sm font-mono">{param.name}</span>
          <Badge
            variant="outline"
            className="text-[10px] border-purple-500/50 text-purple-500"
          >
            {formatParamType(param.type)}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          {validationError && (
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertTriangle className="h-4 w-4 text-destructive" />
              </TooltipTrigger>
              <TooltipContent>{validationError}</TooltipContent>
            </Tooltip>
          )}
          <span className="text-xs text-muted-foreground font-mono">
            {searchSpaceDisplay}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Configuration */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-1 border-t border-border/30 space-y-3">
          {/* Type selection */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Type</Label>
            <div className="grid grid-cols-4 gap-1.5">
              {(
                ["int", "float", "log_float", "categorical"] as FinetuneParamType[]
              ).map((type) => {
                const Icon = getParamTypeIcon(type);
                return (
                  <Button
                    key={type}
                    variant={param.type === type ? "default" : "outline"}
                    size="sm"
                    className={cn(
                      "h-8 text-xs",
                      param.type === type && "bg-purple-500 hover:bg-purple-600"
                    )}
                    onClick={() => {
                      // Reset values when type changes
                      if (type === "categorical") {
                        onUpdate({
                          type,
                          low: undefined,
                          high: undefined,
                          step: undefined,
                          choices: param.choices || [],
                        });
                      } else {
                        onUpdate({
                          type,
                          choices: undefined,
                          low: param.low ?? 1,
                          high: param.high ?? 10,
                          step: type === "int" ? 1 : undefined,
                        });
                      }
                    }}
                  >
                    <Icon className="h-3.5 w-3.5 mr-1" />
                    {formatParamType(type).split(" ")[0]}
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Numeric configuration */}
          {param.type !== "categorical" && (
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Low</Label>
                <Input
                  type="number"
                  value={param.low ?? ""}
                  onChange={(e) =>
                    onUpdate({ low: parseFloat(e.target.value) || 0 })
                  }
                  className="h-8 text-xs font-mono"
                  step={param.type === "int" ? 1 : 0.001}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">High</Label>
                <Input
                  type="number"
                  value={param.high ?? ""}
                  onChange={(e) =>
                    onUpdate({ high: parseFloat(e.target.value) || 10 })
                  }
                  className="h-8 text-xs font-mono"
                  step={param.type === "int" ? 1 : 0.001}
                />
              </div>
              {param.type === "int" && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Step <span className="text-muted-foreground/50">(opt)</span>
                  </Label>
                  <Input
                    type="number"
                    value={param.step ?? ""}
                    onChange={(e) =>
                      onUpdate({
                        step: e.target.value
                          ? parseInt(e.target.value)
                          : undefined,
                      })
                    }
                    className="h-8 text-xs font-mono"
                    placeholder="1"
                    min={1}
                  />
                </div>
              )}
            </div>
          )}

          {/* Categorical configuration */}
          {param.type === "categorical" && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Choices (comma-separated)
              </Label>
              <Input
                value={param.choices?.join(", ") ?? ""}
                onChange={(e) => {
                  const choices = e.target.value
                    .split(",")
                    .map((s) => {
                      const trimmed = s.trim();
                      const num = parseFloat(trimmed);
                      return !isNaN(num) ? num : trimmed;
                    })
                    .filter((v) => v !== "");
                  onUpdate({ choices });
                }}
                className="h-8 text-xs font-mono"
                placeholder="rbf, linear, poly"
              />
            </div>
          )}

          {/* Type-specific hints */}
          {param.type === "log_float" && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Info className="h-3 w-3" />
              Values will be sampled on a logarithmic scale (10^x)
            </p>
          )}
        </div>
      )}
    </div>
  );
}
