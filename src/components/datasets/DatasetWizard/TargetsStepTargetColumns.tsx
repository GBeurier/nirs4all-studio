import {
  AlertCircle,
  Info,
  Layers,
  Loader2,
  RefreshCw,
  RotateCcw,
  Star,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import type { TargetConfig, TaskType } from "@/types/datasets";
import {
  getTargetCandidates,
  type DetectedColumn,
} from "./TargetsStepLogic";

const COMMON_UNITS = ["%", "mg/L", "g/L", "ppm", "ppb", "mg/kg", "g/100g", "\u00b0Brix", "pH", "mS/cm"];
const NO_UNIT_VALUE = "__none__";
const EMPTY_FIELD_LABEL = "\u2014";

interface TargetColumnsSectionProps {
  detectedColumns: DetectedColumn[];
  targets: TargetConfig[];
  defaultTarget?: string;
  loading: boolean;
  error: string | null;
  hasTargetFile: boolean;
  onRefresh: () => void;
  onTargetTypeChange: (column: string, type: TaskType) => void;
  onTargetUnitChange: (column: string, unit: string) => void;
  onSetDefaultTarget: (column: string) => void;
  onResetTargetType: (column: string) => void;
  isTypeModified: (columnName: string, currentType: TaskType) => boolean;
}

interface TargetColumnRowProps {
  column: DetectedColumn;
  targets: TargetConfig[];
  defaultTarget?: string;
  showDefaultSelector: boolean;
  onTargetTypeChange: (column: string, type: TaskType) => void;
  onTargetUnitChange: (column: string, unit: string) => void;
  onSetDefaultTarget: (column: string) => void;
  onResetTargetType: (column: string) => void;
  isTypeModified: (columnName: string, currentType: TaskType) => boolean;
}

export function TargetColumnsSection({
  detectedColumns,
  targets,
  defaultTarget,
  loading,
  error,
  hasTargetFile,
  onRefresh,
  onTargetTypeChange,
  onTargetUnitChange,
  onSetDefaultTarget,
  onResetTargetType,
  isTypeModified,
}: TargetColumnsSectionProps) {
  const targetCandidates = getTargetCandidates(detectedColumns);

  return (
    <div className="flex-1 min-h-0 flex flex-col border rounded-lg">
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">Target Columns</span>
        </div>
        {hasTargetFile && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
            className="h-7 text-xs gap-1.5"
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Refresh
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            <span className="text-sm">Detecting columns...</span>
          </div>
        )}

        {error && !loading && (
          <div className="p-4">
            <div className="flex items-center gap-2 text-amber-600 mb-2">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm font-medium">Detection failed</span>
            </div>
            <p className="text-xs text-muted-foreground mb-2">{error}</p>
            <Button variant="outline" size="sm" onClick={onRefresh} className="h-7 text-xs">
              <RefreshCw className="h-3 w-3 mr-1" />
              Retry
            </Button>
          </div>
        )}

        {!loading && !error && detectedColumns.length > 0 && (
          <div className="divide-y">
            <div className="grid grid-cols-[1fr,100px,110px,70px] gap-2 px-4 py-2 text-xs text-muted-foreground bg-muted/20 font-medium">
              <span>Column</span>
              <span>Detected</span>
              <span>Task Type</span>
              <span className="text-center">Unit</span>
            </div>

            {detectedColumns.map((column) => (
              <TargetColumnRow
                key={column.name}
                column={column}
                targets={targets}
                defaultTarget={defaultTarget}
                showDefaultSelector={targetCandidates.length > 1}
                onTargetTypeChange={onTargetTypeChange}
                onTargetUnitChange={onTargetUnitChange}
                onSetDefaultTarget={onSetDefaultTarget}
                onResetTargetType={onResetTargetType}
                isTypeModified={isTypeModified}
              />
            ))}
          </div>
        )}

        {!loading && !error && detectedColumns.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Info className="h-5 w-5 mb-2" />
            <span className="text-sm">
              {hasTargetFile
                ? "No columns detected in Y file"
                : "Map a file as 'Y' (Targets) to detect columns"}
            </span>
          </div>
        )}
      </div>

      {detectedColumns.length > 0 && (
        <div className="px-4 py-2 border-t bg-muted/20 text-xs text-muted-foreground">
          {detectedColumns.length} column{detectedColumns.length > 1 ? "s" : ""} detected
          {targetCandidates.length > 0 && <> &middot; {targetCandidates.length} target{targetCandidates.length > 1 ? "s" : ""}</>}
          {targetCandidates.length > 1 && (
            <> &middot; <Star className="h-3 w-3 inline text-amber-500 fill-amber-500" /> = default</>
          )}
        </div>
      )}
    </div>
  );
}

function TargetColumnRow({
  column,
  targets,
  defaultTarget,
  showDefaultSelector,
  onTargetTypeChange,
  onTargetUnitChange,
  onSetDefaultTarget,
  onResetTargetType,
  isTypeModified,
}: TargetColumnRowProps) {
  const isTargetCandidate = column.type !== "text";
  const targetConfig = targets.find((target) => target.column === column.name);
  const currentType = targetConfig?.type || column.inferred_task_type;
  const isModified = isTypeModified(column.name, currentType);
  const isDefault = defaultTarget === column.name;

  return (
    <div
      className={`grid grid-cols-[1fr,100px,110px,70px] gap-2 px-4 py-2.5 items-center hover:bg-muted/30 ${!isTargetCandidate ? "opacity-50" : ""}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        {showDefaultSelector && isTargetCandidate && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onSetDefaultTarget(column.name)}
                aria-pressed={isDefault}
                aria-label={isDefault ? "Default target" : `Set ${column.name} as default target`}
                className={`flex-shrink-0 ${isDefault ? "text-amber-500" : "text-muted-foreground/40 hover:text-muted-foreground"}`}
              >
                <Star className={`h-3.5 w-3.5 ${isDefault ? "fill-current" : ""}`} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {isDefault ? "Default target" : "Set as default"}
            </TooltipContent>
          </Tooltip>
        )}
        <span className="font-medium text-sm truncate">{column.name}</span>
      </div>

      <div className="flex items-center gap-1.5">
        <Badge
          variant={column.type === "numeric" ? "default" : column.type === "categorical" ? "secondary" : "outline"}
          className="text-[10px] px-1.5 py-0"
        >
          {column.type === "numeric" ? "num" : column.type === "categorical" ? "cat" : "text"}
        </Badge>
        {isTargetCandidate && (
          <span className="text-xs text-muted-foreground">
            {column.inferred_task_type === "regression" ? "Reg" : "Class"}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        {isTargetCandidate ? (
          <>
            <Select value={currentType} onValueChange={(value) => onTargetTypeChange(column.name, value as TaskType)}>
              <SelectTrigger className="h-7 text-xs px-2 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="regression">Regression</SelectItem>
                <SelectItem value="binary_classification">Binary</SelectItem>
                <SelectItem value="multiclass_classification">Multiclass</SelectItem>
              </SelectContent>
            </Select>
            {isModified && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 flex-shrink-0"
                    onClick={() => onResetTargetType(column.name)}
                    aria-label={`Reset ${column.name} to auto-detected type`}
                  >
                    <RotateCcw className="h-3 w-3 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Reset to auto-detected</TooltipContent>
              </Tooltip>
            )}
          </>
        ) : (
          <span className="text-xs text-muted-foreground italic">Not a target</span>
        )}
      </div>

      <div className="flex justify-center">
        {isTargetCandidate && currentType === "regression" ? (
          <Select
            value={targetConfig?.unit || NO_UNIT_VALUE}
            onValueChange={(value) => onTargetUnitChange(column.name, value === NO_UNIT_VALUE ? "" : value)}
          >
            <SelectTrigger className="h-7 text-xs px-2 w-full">
              <SelectValue placeholder={EMPTY_FIELD_LABEL} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_UNIT_VALUE}>None</SelectItem>
              {COMMON_UNITS.map((unit) => (
                <SelectItem key={unit} value={unit}>{unit}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-xs text-muted-foreground">{EMPTY_FIELD_LABEL}</span>
        )}
      </div>
    </div>
  );
}
