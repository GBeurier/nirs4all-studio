/**
 * Y-Processing Panel Component
 *
 * Phase 4: Advanced Pipeline Features
 *
 * Provides a dedicated UI for configuring target variable (Y) processing,
 * including scaling, transformation, and discretization options.
 *
 * Key features:
 * - Enable/disable toggle with visual feedback
 * - Scaler/transformer selection with descriptions
 * - Parameter configuration per scaler type
 * - Contextual help and recommendations
 * - Integration with pipeline tree visualization
 *
 * This file is the orchestration layer: it owns local UI state and wires
 * callbacks to the pure config helpers in `YProcessingPanelData.ts`. The
 * presentational pieces live in `YProcessingPanelSections.tsx`.
 */

import { useMemo } from "react";
import { BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { type YProcessingConfig } from "./yProcessingConfig";
import {
  buildYProcessingQuickSetup,
  findYProcessingOption,
  getRecommendedScaler,
  resetYProcessingParams,
  setYProcessingEnabled,
  setYProcessingParam,
  setYProcessingScaler,
} from "./YProcessingPanelData";
import {
  YProcessingBody,
  YProcessingDisabledState,
  YProcessingHeader,
} from "./YProcessingPanelSections";

interface YProcessingPanelProps {
  config: YProcessingConfig;
  onChange: (config: YProcessingConfig) => void;
  className?: string;
  compact?: boolean;
}

/**
 * YProcessingPanel - Main panel for configuring target variable processing
 */
export function YProcessingPanel({
  config,
  onChange,
  className,
  compact = false,
}: YProcessingPanelProps) {
  const selectedOption = useMemo(
    () => findYProcessingOption(config.scaler),
    [config.scaler]
  );

  if (compact) {
    return (
      <YProcessingCompact
        config={config}
        onChange={onChange}
        className={className}
      />
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      <YProcessingHeader
        enabled={config.enabled}
        onToggle={(enabled) => onChange(setYProcessingEnabled(config, enabled))}
      />

      {config.enabled && (
        <YProcessingBody
          config={config}
          selectedOption={selectedOption}
          onScalerChange={(scaler) => onChange(setYProcessingScaler(config, scaler))}
          onParamChange={(key, value) => onChange(setYProcessingParam(config, key, value))}
          onReset={() => onChange(resetYProcessingParams(config))}
        />
      )}

      {!config.enabled && <YProcessingDisabledState />}
    </div>
  );
}

/**
 * Compact version of YProcessingPanel for inline use
 */
interface YProcessingCompactProps {
  config: YProcessingConfig;
  onChange: (config: YProcessingConfig) => void;
  className?: string;
}

export function YProcessingCompact({
  config,
  onChange,
  className,
}: YProcessingCompactProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={config.enabled ? "default" : "outline"}
          size="sm"
          className={cn(
            "h-8 gap-2",
            config.enabled && "bg-amber-500 hover:bg-amber-600",
            className
          )}
        >
          <BarChart3 className="h-3.5 w-3.5" />
          <span>y_processing</span>
          {config.enabled && (
            <Badge variant="secondary" className="ml-1 text-[10px] px-1 h-4">
              {config.scaler}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <YProcessingPanel config={config} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Y-Processing Step Badge for display in pipeline tree
 */
interface YProcessingBadgeProps {
  config: YProcessingConfig;
  onClick?: () => void;
  className?: string;
}

export function YProcessingBadge({
  config,
  onClick,
  className,
}: YProcessingBadgeProps) {
  if (!config.enabled) return null;

  const option = findYProcessingOption(config.scaler);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          className={cn(
            "text-[10px] px-1.5 py-0 h-5 bg-amber-500 hover:bg-amber-600 cursor-pointer gap-1",
            className
          )}
          onClick={onClick}
        >
          <BarChart3 className="h-3 w-3" />
          {config.scaler}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top">
        <div className="text-xs">
          <div className="font-semibold">Target Processing</div>
          <p className="text-muted-foreground">
            {option?.description || config.scaler}
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Y-Processing Quick Setup Button
 */
interface YProcessingQuickSetupProps {
  config: YProcessingConfig;
  onChange: (config: YProcessingConfig) => void;
  modelType?: string;
}

export function YProcessingQuickSetup({
  config,
  onChange,
  modelType,
}: YProcessingQuickSetupProps) {
  const handleQuickSetup = () => {
    onChange(buildYProcessingQuickSetup(getRecommendedScaler(modelType)));
  };

  if (config.enabled) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 text-xs border-amber-500/50 text-amber-600 hover:bg-amber-500/10"
      onClick={handleQuickSetup}
    >
      <BarChart3 className="h-3 w-3 mr-1.5" />
      Enable y_processing
    </Button>
  );
}
