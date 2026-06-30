/**
 * MetaModel / Stacking Panel Component
 *
 * Phase 4: Advanced Pipeline Features
 *
 * Provides UI for configuring stacking ensembles (MetaModel) that use
 * out-of-fold predictions from base models as features.
 *
 * Key features:
 * - Visual stacking flow diagram
 * - Base model source selection
 * - Meta-model algorithm selection
 * - Coverage strategy configuration
 * - Integration with branch/merge workflow
 */

import { useState, useMemo } from "react";
import { Boxes } from "lucide-react";
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
import type { StackingConfig } from "./stackingConfig";
import {
  getMetaModelDefaultParams,
  getMetaModelOption,
  getStackingSourceSelection,
  selectStackingMetaModel,
  setStackingCoverageStrategy,
  setStackingEnabled,
  setStackingFillValue,
  setStackingMetaModelParam,
  setStackingPassthrough,
  selectAllStackingSourceModels,
  toggleStackingSourceModel,
  type AvailableStackingModel,
} from "./StackingPanelData";
import {
  AdvancedStackingOptions,
  MetaModelParameters,
  MetaModelSelection,
  SourceModelsSelection,
  StackingDiagram,
  StackingDisabledState,
  StackingInfoNote,
  StackingPanelHeader,
} from "./StackingPanelSections";

interface StackingPanelProps {
  config: StackingConfig;
  onChange: (config: StackingConfig) => void;
  availableModels?: AvailableStackingModel[];
  className?: string;
}

/**
 * StackingPanel - Main panel for configuring stacking ensembles
 */
export function StackingPanel({
  config,
  onChange,
  availableModels = [],
  className,
}: StackingPanelProps) {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  const selectedMetaModel = useMemo(
    () => getMetaModelOption(config.metaModel),
    [config.metaModel],
  );
  const selectedMetaModelDefaultParams = useMemo(
    () => getMetaModelDefaultParams(selectedMetaModel),
    [selectedMetaModel],
  );
  const { isUsingAllSources, selectedSourceCount } =
    getStackingSourceSelection(config, availableModels);

  const handleToggle = (enabled: boolean) => {
    onChange(setStackingEnabled(config, enabled));
  };

  const handleMetaModelChange = (name: string) => {
    onChange(selectStackingMetaModel(config, name));
  };

  const handleParamChange = (key: string, value: unknown) => {
    onChange(setStackingMetaModelParam(config, key, value));
  };

  const handleSourceToggle = (id: string, checked: boolean) => {
    onChange(toggleStackingSourceModel(config, id, checked));
  };

  const handleUseAllSources = () => {
    onChange(selectAllStackingSourceModels(config));
  };

  return (
    <div className={cn("space-y-4", className)}>
      <StackingPanelHeader enabled={config.enabled} onToggle={handleToggle} />

      {config.enabled && (
        <div className="space-y-4 pl-2 border-l-2 border-pink-500/30">
          <StackingDiagram
            sourceCount={selectedSourceCount}
            metaModel={config.metaModel}
            passthrough={config.passthrough}
          />

          <Separator />

          {availableModels.length > 0 && (
            <SourceModelsSelection
              availableModels={availableModels}
              isUsingAllSources={isUsingAllSources}
              sourceModels={config.sourceModels}
              onUseAllSources={handleUseAllSources}
              onSourceToggle={handleSourceToggle}
            />
          )}

          <Separator />

          <MetaModelSelection
            value={config.metaModel}
            selectedMetaModel={selectedMetaModel}
            onMetaModelChange={handleMetaModelChange}
          />

          <MetaModelParameters
            defaultParams={selectedMetaModelDefaultParams}
            params={config.metaModelParams}
            onReset={() =>
              onChange({
                ...config,
                metaModelParams: getMetaModelDefaultParams(selectedMetaModel),
              })
            }
            onParamChange={handleParamChange}
          />

          <AdvancedStackingOptions
            config={config}
            isOpen={isAdvancedOpen}
            onOpenChange={setIsAdvancedOpen}
            onCoverageStrategyChange={(coverageStrategy) =>
              onChange(setStackingCoverageStrategy(config, coverageStrategy))
            }
            onFillValueChange={(fillValue) =>
              onChange(setStackingFillValue(config, fillValue))
            }
            onPassthroughChange={(passthrough) =>
              onChange(setStackingPassthrough(config, passthrough))
            }
          />

          <StackingInfoNote />
        </div>
      )}

      {!config.enabled && <StackingDisabledState />}
    </div>
  );
}

/**
 * Stacking Badge for pipeline tree
 */
interface StackingBadgeProps {
  config: StackingConfig;
  onClick?: () => void;
  className?: string;
}

export function StackingBadge({
  config,
  onClick,
  className,
}: StackingBadgeProps) {
  if (!config.enabled) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          className={cn(
            "text-[10px] px-1.5 py-0 h-5 bg-pink-500 hover:bg-pink-600 cursor-pointer gap-1",
            className
          )}
          onClick={onClick}
        >
          <Boxes className="h-3 w-3" />
          {config.metaModel}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top">
        <div className="text-xs">
          <div className="font-semibold">Stacking Ensemble</div>
          <p className="text-muted-foreground">
            Meta-model: {config.metaModel}
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Compact stacking setup for merge step configuration
 */
interface MergeStackingSetupProps {
  config: StackingConfig;
  onChange: (config: StackingConfig) => void;
  availableModels?: { id: string; name: string; type: string }[];
}

export function MergeStackingSetup({
  config,
  onChange,
  availableModels = [],
}: MergeStackingSetupProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={config.enabled ? "default" : "outline"}
          size="sm"
          className={cn(
            "h-8 gap-2",
            config.enabled && "bg-pink-500 hover:bg-pink-600"
          )}
        >
          <Boxes className="h-3.5 w-3.5" />
          <span>Configure Stacking</span>
          {config.enabled && (
            <Badge variant="secondary" className="ml-1 text-[10px] px-1 h-4">
              {config.metaModel}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96" align="start">
        <StackingPanel
          config={config}
          onChange={onChange}
          availableModels={availableModels}
        />
      </PopoverContent>
    </Popover>
  );
}
