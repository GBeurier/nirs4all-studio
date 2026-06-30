/**
 * Feature Augmentation Panel Component
 *
 * Phase 4: Advanced Pipeline Features
 *
 * Provides UI for configuring feature augmentation - creating multiple
 * preprocessing channels that feed into the model.
 *
 * Key features:
 * - Action mode selection (extend, add, replace)
 * - Transform list management with drag-drop
 * - Visual output shape preview
 * - Integration with step palette for adding transforms
 */

import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
import { generateStepId } from "./stepFactory";
import type {
  FeatureAugmentationAction,
  FeatureAugmentationConfig,
} from "./featureAugmentationConfig";
import {
  FEATURE_AUGMENTATION_ACTION_DETAILS,
  appendFeatureAugmentationTransform,
  applyFeatureAugmentationPreset,
  clearFeatureAugmentationTransforms,
  getActiveFeatureAugmentationTransforms,
  removeFeatureAugmentationTransform,
  setFeatureAugmentationAction,
  setFeatureAugmentationEnabled,
  toggleFeatureAugmentationTransform,
  updateFeatureAugmentationTransformParams,
  type FeatureAugmentationPreset,
} from "./featureAugmentationPanelData";
import {
  FeatureAugmentationActionModeSection,
  FeatureAugmentationDisabledState,
  FeatureAugmentationHeader,
  FeatureAugmentationPreview,
  FeatureAugmentationQuickPresets,
  FeatureAugmentationTransformsSection,
} from "./FeatureAugmentationPanelSections";

interface FeatureAugmentationPanelProps {
  config: FeatureAugmentationConfig;
  onChange: (config: FeatureAugmentationConfig) => void;
  className?: string;
  compact?: boolean;
}

/**
 * FeatureAugmentationPanel - Main panel for configuring feature augmentation
 */
export function FeatureAugmentationPanel({
  config,
  onChange,
  className,
  compact = false,
}: FeatureAugmentationPanelProps) {
  const handleToggle = (enabled: boolean) => {
    onChange(setFeatureAugmentationEnabled(config, enabled));
  };

  const handleActionChange = (action: FeatureAugmentationAction) => {
    onChange(setFeatureAugmentationAction(config, action));
  };

  const handleAddTransform = (name: string, params: Record<string, unknown>) => {
    onChange(
      appendFeatureAugmentationTransform(config, name, params, generateStepId),
    );
  };

  const handleRemoveTransform = (id: string) => {
    onChange(removeFeatureAugmentationTransform(config, id));
  };

  const handleToggleTransform = (id: string, enabled: boolean) => {
    onChange(toggleFeatureAugmentationTransform(config, id, enabled));
  };

  const handleUpdateTransformParams = (
    id: string,
    params: Record<string, unknown>
  ) => {
    onChange(updateFeatureAugmentationTransformParams(config, id, params));
  };

  const handleApplyPreset = (preset: FeatureAugmentationPreset) => {
    onChange(applyFeatureAugmentationPreset(config, preset, generateStepId));
  };

  const handleClearAll = () => {
    onChange(clearFeatureAugmentationTransforms(config));
  };

  const activeTransforms = getActiveFeatureAugmentationTransforms(config);

  if (compact) {
    return (
      <FeatureAugmentationCompact
        config={config}
        onChange={onChange}
        className={className}
      />
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      <FeatureAugmentationHeader
        enabled={config.enabled}
        activeCount={activeTransforms.length}
        onToggle={handleToggle}
      />

      {config.enabled ? (
        <div className="space-y-4 pl-2 border-l-2 border-indigo-500/30">
          <FeatureAugmentationActionModeSection
            action={config.action}
            onActionChange={handleActionChange}
          />

          <Separator />

          <FeatureAugmentationTransformsSection
            transforms={config.transforms}
            onAddTransform={handleAddTransform}
            onClearAll={handleClearAll}
            onRemoveTransform={handleRemoveTransform}
            onToggleTransform={handleToggleTransform}
            onUpdateTransformParams={handleUpdateTransformParams}
          />

          <FeatureAugmentationQuickPresets
            onApplyPreset={handleApplyPreset}
          />

          <Separator />

          <FeatureAugmentationPreview
            transforms={activeTransforms}
            action={config.action}
          />
        </div>
      ) : (
        <FeatureAugmentationDisabledState />
      )}
    </div>
  );
}

/**
 * Compact version for inline use
 */
interface FeatureAugmentationCompactProps {
  config: FeatureAugmentationConfig;
  onChange: (config: FeatureAugmentationConfig) => void;
  className?: string;
}

export function FeatureAugmentationCompact({
  config,
  onChange,
  className,
}: FeatureAugmentationCompactProps) {
  const activeCount = getActiveFeatureAugmentationTransforms(config).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={config.enabled ? "default" : "outline"}
          size="sm"
          className={cn(
            "h-8 gap-2",
            config.enabled && "bg-indigo-500 hover:bg-indigo-600",
            className
          )}
        >
          <Layers className="h-3.5 w-3.5" />
          <span>feature_augmentation</span>
          {config.enabled && activeCount > 0 && (
            <Badge variant="secondary" className="ml-1 text-[10px] px-1 h-4">
              {activeCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96" align="start">
        <FeatureAugmentationPanel config={config} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Feature Augmentation Badge for pipeline tree
 */
interface FeatureAugmentationBadgeProps {
  config: FeatureAugmentationConfig;
  onClick?: () => void;
  className?: string;
}

export function FeatureAugmentationBadge({
  config,
  onClick,
  className,
}: FeatureAugmentationBadgeProps) {
  if (!config.enabled) return null;

  const activeCount = getActiveFeatureAugmentationTransforms(config).length;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          className={cn(
            "text-[10px] px-1.5 py-0 h-5 bg-indigo-500 hover:bg-indigo-600 cursor-pointer gap-1",
            className
          )}
          onClick={onClick}
        >
          <Layers className="h-3 w-3" />
          {activeCount} aug
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top">
        <div className="text-xs">
          <div className="font-semibold">Feature Augmentation</div>
          <p className="text-muted-foreground">
            {`${activeCount} transforms (${FEATURE_AUGMENTATION_ACTION_DETAILS[config.action].label} mode)`}
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
