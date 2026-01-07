/**
 * StepShapeIndicator - Display shape information for a pipeline step
 *
 * Phase 4 Implementation: Pipeline Integration
 * @see docs/ROADMAP_DATASETS_WORKSPACE.md
 *
 * Features:
 * - T4.6: Display shape changes in pipeline tree
 * - T4.7: Warn when step params exceed data dimensions
 *
 * Shows the data shape at each step and highlights changes/warnings.
 */

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AlertTriangle, ArrowRight, Layers } from "lucide-react";
import { useStepShape, useStepDimensionWarnings } from "../../contexts/DatasetBindingContext";
import type { DataShape } from "../../DatasetBinding";
import type { ShapeWarning, ShapeAtStep } from "@/hooks/useShapePropagation";

/**
 * Props for StepShapeIndicator
 */
export interface StepShapeIndicatorProps {
  stepId: string;
  /** Compact mode only shows output shape */
  compact?: boolean;
}

/**
 * Format shape as a string
 */
function formatShape(shape: DataShape): string {
  return `(${shape.samples.toLocaleString()}, ${shape.features.toLocaleString()})`;
}

/**
 * Check if shape changed
 */
function hasShapeChange(input: DataShape, output: DataShape): boolean {
  return input.samples !== output.samples || input.features !== output.features;
}

/**
 * StepShapeIndicator - Shows shape info for a step
 */
export function StepShapeIndicator({ stepId, compact = true }: StepShapeIndicatorProps) {
  const shapeAtStep = useStepShape(stepId);
  const warnings = useStepDimensionWarnings(stepId);

  if (!shapeAtStep) {
    return null;
  }

  const { inputShape, outputShape } = shapeAtStep;
  const hasChange = hasShapeChange(inputShape, outputShape);
  const hasWarnings = warnings.length > 0;
  const hasErrors = warnings.some((w) => w.severity === "error");

  if (compact) {
    // Compact mode: just show output shape with optional warning
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={`text-[9px] px-1 py-0 h-4 font-mono shrink-0 cursor-help ${
              hasErrors
                ? "border-red-500/50 text-red-500"
                : hasWarnings
                ? "border-amber-500/50 text-amber-500"
                : hasChange
                ? "border-emerald-500/50 text-emerald-500"
                : "border-border text-muted-foreground"
            }`}
          >
            {hasWarnings && <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />}
            {hasChange && !hasWarnings && <ArrowRight className="h-2.5 w-2.5 mr-0.5" />}
            {formatShape(outputShape)}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-xs">
          <ShapeTooltipContent
            inputShape={inputShape}
            outputShape={outputShape}
            hasChange={hasChange}
            warnings={warnings}
          />
        </TooltipContent>
      </Tooltip>
    );
  }

  // Full mode: show input → output with details
  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="font-mono text-muted-foreground">
        {formatShape(inputShape)}
      </span>
      <ArrowRight className="h-3 w-3 text-muted-foreground" />
      <span
        className={`font-mono ${
          hasErrors
            ? "text-red-500"
            : hasWarnings
            ? "text-amber-500"
            : hasChange
            ? "text-emerald-500"
            : "text-muted-foreground"
        }`}
      >
        {formatShape(outputShape)}
      </span>
      {hasWarnings && (
        <Tooltip>
          <TooltipTrigger asChild>
            <AlertTriangle
              className={`h-3.5 w-3.5 ${
                hasErrors ? "text-red-500" : "text-amber-500"
              }`}
            />
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-xs">
            <WarningsContent warnings={warnings} />
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

/**
 * Tooltip content for shape display
 */
function ShapeTooltipContent({
  inputShape,
  outputShape,
  hasChange,
  warnings,
}: {
  inputShape: DataShape;
  outputShape: DataShape;
  hasChange: boolean;
  warnings: ShapeWarning[];
}) {
  const samplesDiff = outputShape.samples - inputShape.samples;
  const featuresDiff = outputShape.features - inputShape.features;

  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center gap-2">
        <Layers className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">Shape Propagation</span>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Input:</span>
          <span className="font-mono">{formatShape(inputShape)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Output:</span>
          <span className={`font-mono ${hasChange ? "text-emerald-500" : ""}`}>
            {formatShape(outputShape)}
          </span>
        </div>
      </div>

      {hasChange && (
        <div className="pt-1 border-t border-border">
          {samplesDiff !== 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span>Samples:</span>
              <span className={samplesDiff < 0 ? "text-amber-500" : "text-emerald-500"}>
                {samplesDiff > 0 ? "+" : ""}{samplesDiff.toLocaleString()}
              </span>
            </div>
          )}
          {featuresDiff !== 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span>Features:</span>
              <span className={featuresDiff < 0 ? "text-amber-500" : "text-emerald-500"}>
                {featuresDiff > 0 ? "+" : ""}{featuresDiff.toLocaleString()}
              </span>
            </div>
          )}
        </div>
      )}

      {warnings.length > 0 && <WarningsContent warnings={warnings} />}
    </div>
  );
}

/**
 * Warnings list content
 */
function WarningsContent({ warnings }: { warnings: ShapeWarning[] }) {
  return (
    <div className="pt-1 border-t border-border space-y-1">
      <div className="flex items-center gap-1 text-amber-500 font-medium">
        <AlertTriangle className="h-3 w-3" />
        <span>Warnings</span>
      </div>
      {warnings.map((warning, idx) => (
        <div key={idx} className={`text-${warning.severity === "error" ? "red" : "amber"}-500`}>
          • {warning.message}
        </div>
      ))}
    </div>
  );
}

/**
 * Compact shape badge for use in headers
 */
export interface ShapeBadgeProps {
  shape: DataShape;
  variant?: "default" | "input" | "output" | "warning" | "error";
  className?: string;
}

export function ShapeBadge({ shape, variant = "default", className = "" }: ShapeBadgeProps) {
  const variantStyles = {
    default: "border-border text-muted-foreground",
    input: "border-blue-500/50 text-blue-500",
    output: "border-emerald-500/50 text-emerald-500",
    warning: "border-amber-500/50 text-amber-500",
    error: "border-red-500/50 text-red-500",
  };

  return (
    <Badge
      variant="outline"
      className={`text-[9px] px-1 py-0 h-4 font-mono shrink-0 ${variantStyles[variant]} ${className}`}
    >
      {formatShape(shape)}
    </Badge>
  );
}

/**
 * Shape flow indicator showing input → output
 */
export interface ShapeFlowProps {
  inputShape: DataShape;
  outputShape: DataShape;
  className?: string;
}

export function ShapeFlow({ inputShape, outputShape, className = "" }: ShapeFlowProps) {
  const hasChange = hasShapeChange(inputShape, outputShape);

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <ShapeBadge shape={inputShape} variant="input" />
      <ArrowRight className="h-3 w-3 text-muted-foreground" />
      <ShapeBadge
        shape={outputShape}
        variant={hasChange ? "output" : "default"}
      />
    </div>
  );
}
