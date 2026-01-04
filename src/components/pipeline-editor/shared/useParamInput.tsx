/**
 * useParamInput Hook
 *
 * Extracts parameter input rendering logic from StepConfigPanel.
 * Provides a reusable hook for rendering parameter inputs with sweep support.
 *
 * Phase 3 Implementation - Component Refactoring
 * @see docs/_internals/implementation_roadmap.md
 */

import { useCallback } from "react";
import { Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
import { SweepConfigPopover } from "../SweepConfigPopover";
import type { ParameterSweep } from "../types";

// Parameter info/tooltips for common parameters
export const parameterInfo: Record<string, string> = {
  n_components: "Number of components/latent variables to use",
  n_estimators: "Number of trees in the ensemble",
  max_depth: "Maximum depth of trees",
  learning_rate: "Step size for gradient descent optimization",
  test_size: "Proportion of data to use for testing (0.0-1.0)",
  n_splits: "Number of folds for cross-validation",
  random_state: "Random seed for reproducibility",
  window_length: "Size of the moving window (must be odd)",
  window: "Size of the moving window (must be odd)",
  window_size: "Size of the moving window",
  polyorder: "Polynomial order for fitting",
  deriv: "Derivative order (0=smoothing, 1=first, 2=second)",
  sigma: "Standard deviation for Gaussian kernel",
  order: "Polynomial order for baseline/detrending",
  lam: "Smoothing parameter (lambda) - higher = smoother baseline",
  p: "Asymmetry parameter (0 to 1) - lower emphasizes troughs",
  C: "Regularization parameter (higher = less regularization)",
  epsilon: "Epsilon in epsilon-SVR model",
  kernel: "Kernel type for SVM (rbf, linear, poly)",
  gamma: "Kernel coefficient for rbf/poly/sigmoid",
  alpha: "Regularization strength",
  l1_ratio: "L1 ratio for Elastic Net (0=L2, 1=L1)",
  shuffle: "Whether to shuffle data before splitting",
  n_repeats: "Number of times to repeat cross-validation",
};

// Select options for known parameter types
const selectOptions: Record<string, Array<{ value: string; label: string }>> = {
  kernel: [
    { value: "rbf", label: "RBF (Radial Basis Function)" },
    { value: "linear", label: "Linear" },
    { value: "poly", label: "Polynomial" },
    { value: "sigmoid", label: "Sigmoid" },
  ],
  norm: [
    { value: "l1", label: "L1 (Manhattan)" },
    { value: "l2", label: "L2 (Euclidean)" },
    { value: "max", label: "Max" },
  ],
  activation: [
    { value: "relu", label: "ReLU" },
    { value: "tanh", label: "Tanh" },
    { value: "sigmoid", label: "Sigmoid" },
    { value: "leaky_relu", label: "Leaky ReLU" },
  ],
  reference: [
    { value: "mean", label: "Mean Spectrum" },
    { value: "first", label: "First Spectrum" },
    { value: "median", label: "Median Spectrum" },
  ],
};

// Keys that should render as select inputs
const selectParamKeys = new Set(Object.keys(selectOptions));

interface UseParamInputOptions {
  paramSweeps?: Record<string, ParameterSweep>;
  onParamChange: (key: string, value: string | number | boolean) => void;
  onSweepChange: (key: string, sweep: ParameterSweep | undefined) => void;
}

/**
 * Hook that provides a render function for parameter inputs with sweep support.
 */
export function useParamInput({
  paramSweeps,
  onParamChange,
  onSweepChange,
}: UseParamInputOptions) {
  const renderParamInput = useCallback(
    (key: string, value: string | number | boolean) => {
      const info = parameterInfo[key];
      const sweep = paramSweeps?.[key];
      const hasSweepActive = !!sweep;

      // Boolean parameters
      if (typeof value === "boolean") {
        return (
          <BooleanParamInput
            key={key}
            paramKey={key}
            value={value}
            info={info}
            sweep={sweep}
            hasSweepActive={hasSweepActive}
            onParamChange={onParamChange}
            onSweepChange={onSweepChange}
          />
        );
      }

      // Select parameters for known options
      if (selectParamKeys.has(key)) {
        return (
          <SelectParamInput
            key={key}
            paramKey={key}
            value={value}
            info={info}
            sweep={sweep}
            hasSweepActive={hasSweepActive}
            onParamChange={onParamChange}
            onSweepChange={onSweepChange}
          />
        );
      }

      // Number or string parameters
      return (
        <TextParamInput
          key={key}
          paramKey={key}
          value={value}
          info={info}
          sweep={sweep}
          hasSweepActive={hasSweepActive}
          onParamChange={onParamChange}
          onSweepChange={onSweepChange}
        />
      );
    },
    [paramSweeps, onParamChange, onSweepChange]
  );

  return { renderParamInput };
}

// ============================================================================
// Shared Components
// ============================================================================

interface ParamInputBaseProps {
  paramKey: string;
  info?: string;
  sweep?: ParameterSweep;
  hasSweepActive: boolean;
  onParamChange: (key: string, value: string | number | boolean) => void;
  onSweepChange: (key: string, sweep: ParameterSweep | undefined) => void;
}

/**
 * Label with optional info tooltip and sweep indicator
 */
function ParamLabel({
  paramKey,
  info,
  hasSweepActive,
}: {
  paramKey: string;
  info?: string;
  hasSweepActive: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Label
        className={`text-sm capitalize ${hasSweepActive ? "text-orange-500" : ""}`}
      >
        {paramKey.replace(/_/g, " ")}
      </Label>
      {info && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-[200px]">
            <p>{info}</p>
          </TooltipContent>
        </Tooltip>
      )}
      {hasSweepActive && (
        <Badge
          variant="outline"
          className="text-[10px] px-1 h-4 border-orange-500/50 text-orange-500"
        >
          sweep
        </Badge>
      )}
    </div>
  );
}

/**
 * Boolean parameter input (switch)
 */
function BooleanParamInput({
  paramKey,
  value,
  info,
  sweep,
  hasSweepActive,
  onParamChange,
  onSweepChange,
}: ParamInputBaseProps & { value: boolean }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between py-2">
        <ParamLabel paramKey={paramKey} info={info} hasSweepActive={hasSweepActive} />
        <Switch
          checked={value}
          onCheckedChange={(checked) => onParamChange(paramKey, checked)}
          disabled={hasSweepActive}
        />
      </div>
      <SweepConfigPopover
        paramKey={paramKey}
        currentValue={value}
        sweep={sweep}
        onSweepChange={(s) => onSweepChange(paramKey, s)}
      />
    </div>
  );
}

/**
 * Select parameter input (dropdown)
 */
function SelectParamInput({
  paramKey,
  value,
  info,
  sweep,
  hasSweepActive,
  onParamChange,
  onSweepChange,
}: ParamInputBaseProps & { value: string | number | boolean }) {
  const options = selectOptions[paramKey] || [];

  return (
    <div className="space-y-2">
      <ParamLabel paramKey={paramKey} info={info} hasSweepActive={hasSweepActive} />
      <Select
        value={String(value)}
        onValueChange={(v) => onParamChange(paramKey, v)}
        disabled={hasSweepActive}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-popover">
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <SweepConfigPopover
        paramKey={paramKey}
        currentValue={value}
        sweep={sweep}
        onSweepChange={(s) => onSweepChange(paramKey, s)}
      />
    </div>
  );
}

/**
 * Text/Number parameter input
 */
function TextParamInput({
  paramKey,
  value,
  info,
  sweep,
  hasSweepActive,
  onParamChange,
  onSweepChange,
}: ParamInputBaseProps & { value: string | number | boolean }) {
  const isNumber = typeof value === "number";

  return (
    <div className="space-y-2">
      <ParamLabel paramKey={paramKey} info={info} hasSweepActive={hasSweepActive} />
      <Input
        type={isNumber ? "number" : "text"}
        value={value as string | number}
        onChange={(e) => {
          const newValue = isNumber
            ? parseFloat(e.target.value) || 0
            : e.target.value;
          onParamChange(paramKey, newValue);
        }}
        step={
          isNumber
            ? (value as number) < 1 && (value as number) > 0
              ? 0.01
              : 1
            : undefined
        }
        className="font-mono text-sm"
        disabled={hasSweepActive}
      />
      <SweepConfigPopover
        paramKey={paramKey}
        currentValue={value}
        sweep={sweep}
        onSweepChange={(s) => onSweepChange(paramKey, s)}
      />
    </div>
  );
}

export default useParamInput;
