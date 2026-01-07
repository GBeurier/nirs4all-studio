/**
 * DatasetBinding - Dataset binding for Pipeline Editor
 *
 * Phase 4 Implementation: Pipeline Integration
 * @see docs/ROADMAP_DATASETS_WORKSPACE.md
 *
 * Features:
 * - T4.1: Bind Dataset dropdown in Pipeline Editor header
 * - T4.2: Local state binding (not saved with pipeline)
 * - T4.4: Show sample/feature counts next to binding
 *
 * The binding enables:
 * - Presizing: Show actual feature count for dimension-aware steps
 * - Validation: Warn if pipeline incompatible with data shape
 * - Preview: Run mini-pipeline on subset for visualization
 */

import { useState, useCallback } from "react";
import {
  Database,
  X,
  ChevronDown,
  AlertTriangle,
  Info,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
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
import { TargetSelector, TargetBadge } from "@/components/datasets/TargetSelector";
import type { Dataset, TargetConfig } from "@/types/datasets";

/**
 * Shape information for data flowing through the pipeline
 */
export interface DataShape {
  samples: number;
  features: number;
  /** Optional source dimension for multi-source datasets */
  sources?: number;
}

/**
 * Bound dataset information for pipeline context
 */
export interface BoundDataset {
  id: string;
  name: string;
  path: string;
  shape: DataShape;
  targets?: TargetConfig[];
  selectedTarget?: string;
  taskType?: "regression" | "classification";
}

/**
 * Props for DatasetBinding component
 */
export interface DatasetBindingProps {
  /** Currently bound dataset (null if none) */
  boundDataset: BoundDataset | null;
  /** Available datasets to bind */
  datasets: Dataset[];
  /** Whether datasets are loading */
  isLoading?: boolean;
  /** Callback when a dataset is bound */
  onBind: (dataset: Dataset) => void;
  /** Callback when binding is cleared */
  onClear: () => void;
  /** Callback when target is selected */
  onSelectTarget?: (targetColumn: string) => void;
  /** Callback to refresh datasets list */
  onRefresh?: () => void;
  /** Whether the binding has dimension warnings */
  hasWarnings?: boolean;
  /** Warning message to display */
  warningMessage?: string;
}

/**
 * DatasetBinding - Dropdown for binding a dataset to the pipeline editor
 *
 * Allows users to temporarily bind a dataset to enable:
 * - Shape-aware parameter validation
 * - Dimension display in pipeline tree
 * - Mini-pipeline previews
 */
export function DatasetBinding({
  boundDataset,
  datasets,
  isLoading = false,
  onBind,
  onClear,
  onSelectTarget,
  onRefresh,
  hasWarnings = false,
  warningMessage,
}: DatasetBindingProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleSelect = useCallback(
    (dataset: Dataset) => {
      onBind(dataset);
      setIsOpen(false);
    },
    [onBind]
  );

  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClear();
    },
    [onClear]
  );

  // Group datasets by availability
  const availableDatasets = datasets.filter((d) => d.status === "available");
  const missingDatasets = datasets.filter((d) => d.status === "missing");

  return (
    <div className="flex items-center gap-2">
      {/* Dataset Dropdown */}
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant={boundDataset ? "secondary" : "outline"}
            size="sm"
            className={`gap-2 ${hasWarnings ? "border-amber-500/50" : ""}`}
          >
            <Database className="h-4 w-4" />
            {boundDataset ? (
              <>
                <span className="max-w-32 truncate">{boundDataset.name}</span>
                <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">
                  {boundDataset.shape.samples.toLocaleString()} × {boundDataset.shape.features.toLocaleString()}
                </Badge>
              </>
            ) : (
              <span>Bind Dataset</span>
            )}
            <ChevronDown className="h-3 w-3 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80 bg-popover">
          <DropdownMenuLabel className="flex items-center justify-between">
            <span>Data Binding</span>
            {onRefresh && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={(e) => {
                  e.stopPropagation();
                  onRefresh();
                }}
              >
                <RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} />
              </Button>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading datasets...</span>
            </div>
          ) : datasets.length === 0 ? (
            <div className="py-6 text-center">
              <Database className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">No datasets available</p>
              <p className="text-xs text-muted-foreground mt-1">
                Link a dataset in the Datasets page
              </p>
            </div>
          ) : (
            <>
              {/* Current binding with clear option */}
              {boundDataset && (
                <>
                  <div className="px-2 py-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Database className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">{boundDataset.name}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={handleClear}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                  <DropdownMenuSeparator />
                </>
              )}

              {/* Available datasets */}
              {availableDatasets.length > 0 && (
                <>
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    Available ({availableDatasets.length})
                  </DropdownMenuLabel>
                  {availableDatasets.map((dataset) => (
                    <DropdownMenuItem
                      key={dataset.id}
                      onClick={() => handleSelect(dataset)}
                      className={boundDataset?.id === dataset.id ? "bg-accent" : ""}
                    >
                      <div className="flex items-center gap-2 w-full">
                        <Database className="h-4 w-4 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{dataset.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {dataset.num_samples?.toLocaleString() || "?"} samples ·{" "}
                            {dataset.num_features?.toLocaleString() || "?"} features
                          </div>
                        </div>
                        {dataset.task_type && (
                          <Badge variant="outline" className="text-xs">
                            {dataset.task_type}
                          </Badge>
                        )}
                      </div>
                    </DropdownMenuItem>
                  ))}
                </>
              )}

              {/* Missing datasets */}
              {missingDatasets.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    Missing ({missingDatasets.length})
                  </DropdownMenuLabel>
                  {missingDatasets.map((dataset) => (
                    <DropdownMenuItem
                      key={dataset.id}
                      disabled
                      className="opacity-50"
                    >
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-500" />
                        <span className="truncate">{dataset.name}</span>
                      </div>
                    </DropdownMenuItem>
                  ))}
                </>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Target selector (when dataset is bound and has multiple targets) */}
      {boundDataset && boundDataset.targets && boundDataset.targets.length > 1 && onSelectTarget && (
        <TargetSelector
          datasetId={boundDataset.id}
          value={boundDataset.selectedTarget}
          onChange={(targetColumn) => onSelectTarget(targetColumn)}
          targets={boundDataset.targets}
          compact
        />
      )}

      {/* Single target badge */}
      {boundDataset && boundDataset.targets && boundDataset.targets.length === 1 && (
        <TargetBadge target={boundDataset.targets[0]} />
      )}

      {/* Warning indicator */}
      {hasWarnings && warningMessage && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="p-1.5 rounded-md bg-amber-500/10">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            {warningMessage}
          </TooltipContent>
        </Tooltip>
      )}

      {/* Info tooltip */}
      {boundDataset && !hasWarnings && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors cursor-help">
              <Info className="h-3.5 w-3.5" />
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <p className="text-xs">
              Dataset bound for shape validation. This binding is local and not
              saved with the pipeline.
            </p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

/**
 * DatasetShapeDisplay - Compact display of dataset shape in pipeline context
 */
export interface DatasetShapeDisplayProps {
  shape: DataShape;
  className?: string;
}

export function DatasetShapeDisplay({ shape, className = "" }: DatasetShapeDisplayProps) {
  return (
    <div className={`flex items-center gap-1 text-xs text-muted-foreground ${className}`}>
      <span className="font-mono">
        ({shape.samples.toLocaleString()}, {shape.features.toLocaleString()})
      </span>
      {shape.sources && shape.sources > 1 && (
        <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
          {shape.sources} sources
        </Badge>
      )}
    </div>
  );
}

/**
 * ShapeChangeIndicator - Shows how shape changes through a step
 */
export interface ShapeChangeIndicatorProps {
  inputShape: DataShape;
  outputShape: DataShape;
  className?: string;
}

export function ShapeChangeIndicator({
  inputShape,
  outputShape,
  className = "",
}: ShapeChangeIndicatorProps) {
  const hasChange =
    inputShape.samples !== outputShape.samples ||
    inputShape.features !== outputShape.features;

  if (!hasChange) {
    return (
      <span className={`text-xs text-muted-foreground font-mono ${className}`}>
        ({outputShape.samples.toLocaleString()}, {outputShape.features.toLocaleString()})
      </span>
    );
  }

  const samplesDiff = outputShape.samples - inputShape.samples;
  const featuresDiff = outputShape.features - inputShape.features;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`text-xs font-mono cursor-help ${
            featuresDiff < 0 || samplesDiff < 0
              ? "text-amber-500"
              : "text-emerald-500"
          } ${className}`}
        >
          ({outputShape.samples.toLocaleString()}, {outputShape.features.toLocaleString()})
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="text-xs space-y-1">
          {samplesDiff !== 0 && (
            <div>
              Samples: {samplesDiff > 0 ? "+" : ""}{samplesDiff.toLocaleString()}
            </div>
          )}
          {featuresDiff !== 0 && (
            <div>
              Features: {featuresDiff > 0 ? "+" : ""}{featuresDiff.toLocaleString()}
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * DimensionWarningBadge - Warning badge for dimension issues
 */
export interface DimensionWarningBadgeProps {
  paramName: string;
  paramValue: number;
  maxValue: number;
  stepName?: string;
}

export function DimensionWarningBadge({
  paramName,
  paramValue,
  maxValue,
  stepName,
}: DimensionWarningBadgeProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className="text-xs border-amber-500/50 text-amber-500 gap-1"
        >
          <AlertTriangle className="h-3 w-3" />
          {paramName}: {paramValue} &gt; {maxValue}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p className="text-xs">
          {stepName && <strong>{stepName}: </strong>}
          Parameter <code>{paramName}</code> ({paramValue}) exceeds the available
          dimension ({maxValue}). This may cause an error during execution.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
