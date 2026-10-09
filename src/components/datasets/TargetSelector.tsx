/**
 * TargetSelector - Reusable component for selecting target columns from a dataset
 *
 * Used in:
 * - Experiment wizard (T3.5)
 * - Pipeline Editor dataset binding (T3.6)
 * - Prediction workflows
 *
 * Features:
 * - Shows available targets from dataset
 * - Displays target type (regression/classification)
 * - Shows units for regression targets
 * - Allows selecting default or specific target
 */
import { useState, useEffect } from "react";
import i18n from "i18next";
import { useTranslation } from "react-i18next";
import {
  Target,
  ChevronDown,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getDatasetTargets } from "@/api/datasets";
import type { TargetConfig, TaskType } from "@/types/datasets";

interface TargetSelectorProps {
  /** Dataset ID to load targets from */
  datasetId: string;
  /** Currently selected target column */
  value?: string;
  /** Callback when target selection changes */
  onChange?: (targetColumn: string, targetConfig?: TargetConfig) => void;
  /** Whether to include "Use Default" option */
  showDefaultOption?: boolean;
  /** Pre-loaded targets (skip API call if provided) */
  targets?: TargetConfig[];
  /** Default target from dataset config */
  defaultTarget?: string;
  /** Disable the selector */
  disabled?: boolean;
  /** Compact mode for inline usage */
  compact?: boolean;
  /** Custom placeholder text */
  placeholder?: string;
  /** Error handler */
  onError?: (error: string) => void;
}

/**
 * Get badge variant based on task type
 */
function getTaskTypeBadgeVariant(type: TaskType): "default" | "secondary" | "outline" {
  switch (type) {
    case "regression":
      return "default";
    case "classification":
    case "binary_classification":
    case "multiclass_classification":
      return "secondary";
    default:
      return "outline";
  }
}

/**
 * Get short label for task type
 */
function getTaskTypeLabelKey(type: TaskType): string {
  switch (type) {
    case "regression":
      return "datasets.targetSelector.typeReg";
    case "classification":
      return "datasets.targetSelector.typeClass";
    case "binary_classification":
      return "datasets.targetSelector.typeBinary";
    case "multiclass_classification":
      return "datasets.targetSelector.typeMulti";
    default:
      return "datasets.targetSelector.typeAuto";
  }
}

export function TargetSelector({
  datasetId,
  value,
  onChange,
  showDefaultOption = true,
  targets: providedTargets,
  defaultTarget: providedDefaultTarget,
  disabled = false,
  compact = false,
  placeholder,
  onError,
}: TargetSelectorProps) {
  const { t } = useTranslation();
  const [targets, setTargets] = useState<TargetConfig[]>(providedTargets || []);
  const [defaultTarget, setDefaultTarget] = useState<string | null>(
    providedDefaultTarget || null
  );
  const [loading, setLoading] = useState(!providedTargets);
  const [error, setError] = useState<string | null>(null);

  // Load targets from API if not provided
  useEffect(() => {
    if (providedTargets) {
      setTargets(providedTargets);
      setDefaultTarget(providedDefaultTarget || null);
      setLoading(false);
      return;
    }

    if (!datasetId) {
      setTargets([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    getDatasetTargets(datasetId)
      .then((result) => {
        setTargets(result.targets);
        setDefaultTarget(result.default_target);
        setLoading(false);
      })
      .catch((e) => {
        const message = e instanceof Error ? e.message : i18n.t("datasets.targetSelector.loadFailed");
        setError(message);
        onError?.(message);
        setLoading(false);
      });
  }, [datasetId, providedTargets, providedDefaultTarget, onError]);

  // Get currently selected target config
  const selectedTarget = targets.find((t) => t.column === value);
  const isUsingDefault = value === undefined || value === defaultTarget;

  // Handle selection
  const handleSelect = (targetColumn: string | undefined) => {
    const target = targets.find((t) => t.column === targetColumn);
    onChange?.(targetColumn || defaultTarget || "", target);
  };

  if (loading) {
    return (
      <Button variant="outline" disabled className={compact ? "h-8" : ""}>
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        {t("common.loading")}
      </Button>
    );
  }

  if (error) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" disabled className={compact ? "h-8" : ""}>
              <AlertCircle className="h-4 w-4 text-destructive mr-2" />
              {t("common.error")}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{error}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (targets.length === 0) {
    return (
      <Button variant="outline" disabled className={compact ? "h-8" : ""}>
        <Target className="h-4 w-4 mr-2 opacity-50" />
        {t("datasets.quickView.noTargets")}
      </Button>
    );
  }

  // Single target - just show it
  if (targets.length === 1) {
    const target = targets[0];
    return (
      <Button variant="outline" disabled className={compact ? "h-8" : ""}>
        <Target className="h-4 w-4 mr-2" />
        {target.column}
        {target.unit && (
          <span className="ml-1 opacity-70">({target.unit})</span>
        )}
        <Badge
          variant={getTaskTypeBadgeVariant(target.type)}
          className="ml-2 text-xs"
        >
          {t(getTaskTypeLabelKey(target.type))}
        </Badge>
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={compact ? "h-8" : ""}
        >
          <Target className="h-4 w-4 mr-2" />
          {selectedTarget ? (
            <>
              {selectedTarget.column}
              {selectedTarget.unit && (
                <span className="ml-1 opacity-70">({selectedTarget.unit})</span>
              )}
              <Badge
                variant={getTaskTypeBadgeVariant(selectedTarget.type)}
                className="ml-2 text-xs"
              >
                {t(getTaskTypeLabelKey(selectedTarget.type))}
              </Badge>
            </>
          ) : isUsingDefault && defaultTarget ? (
            <>
              {defaultTarget}
              <Badge variant="outline" className="ml-2 text-xs">
                {t("datasets.targetSelector.defaultBadge")}
              </Badge>
            </>
          ) : (
            <span className="opacity-70">{placeholder ?? t("datasets.targetSelector.placeholder")}</span>
          )}
          <ChevronDown className="h-4 w-4 ml-2 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="flex items-center gap-2">
          <Target className="h-4 w-4" />
          {t("datasets.targetSelector.menuLabel")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {showDefaultOption && defaultTarget && (
          <>
            <DropdownMenuItem
              onClick={() => handleSelect(undefined)}
              className={isUsingDefault ? "bg-accent" : ""}
            >
              <div className="flex items-center justify-between w-full">
                <span>{t("datasets.targetSelector.useDefault")}</span>
                <Badge variant="outline" className="text-xs">
                  {defaultTarget}
                </Badge>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}

        {targets.map((target) => (
          <DropdownMenuItem
            key={target.column}
            onClick={() => handleSelect(target.column)}
            className={value === target.column ? "bg-accent" : ""}
          >
            <div className="flex items-center justify-between w-full gap-2">
              <div className="flex items-center gap-2">
                <span className="font-medium">{target.column}</span>
                {target.unit && (
                  <span className="text-xs opacity-70">({target.unit})</span>
                )}
              </div>
              <Badge
                variant={getTaskTypeBadgeVariant(target.type)}
                className="text-xs"
              >
                {t(getTaskTypeLabelKey(target.type))}
              </Badge>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Inline target badge for display purposes (read-only)
 */
interface TargetBadgeProps {
  target: TargetConfig;
  isDefault?: boolean;
}

export function TargetBadge({ target, isDefault }: TargetBadgeProps) {
  const { t } = useTranslation();
  return (
    <Badge
      variant={isDefault ? "default" : "outline"}
      className="text-xs gap-1"
    >
      <Target className="h-3 w-3" />
      {target.column}
      {target.unit && <span className="opacity-70">({target.unit})</span>}
      <span className="opacity-50">•</span>
      <span className="opacity-70">{t(getTaskTypeLabelKey(target.type))}</span>
      {isDefault && <span className="opacity-50">({t("datasets.targetSelector.defaultBadge")})</span>}
    </Badge>
  );
}

/**
 * Multi-target display for showing all targets in a dataset
 */
interface TargetsListProps {
  targets: TargetConfig[];
  defaultTarget?: string;
  maxVisible?: number;
}

export function TargetsList({
  targets,
  defaultTarget,
  maxVisible = 3,
}: TargetsListProps) {
  const { t } = useTranslation();
  if (!targets || targets.length === 0) {
    return (
      <span className="text-xs text-muted-foreground">{t("datasets.targetSelector.noneConfigured")}</span>
    );
  }

  const visibleTargets = targets.slice(0, maxVisible);
  const hiddenCount = targets.length - maxVisible;

  return (
    <div className="flex flex-wrap gap-1">
      {visibleTargets.map((target) => (
        <TargetBadge
          key={target.column}
          target={target}
          isDefault={target.column === defaultTarget}
        />
      ))}
      {hiddenCount > 0 && (
        <Badge variant="outline" className="text-xs">
          {t("datasets.targetSelector.more", { count: hiddenCount })}
        </Badge>
      )}
    </div>
  );
}

export default TargetSelector;
