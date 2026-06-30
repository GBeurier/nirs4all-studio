/**
 * Step 4: Target & Metadata Configuration
 *
 * Displays auto-detected columns with their inferred types.
 * Allows overriding task type per column.
 */
import { useState, useEffect, useCallback } from "react";
import { Repeat } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { getRepeatIndexColumnWarning } from "@/lib/playground/repetition";
import { useWizard } from "./useWizard";
import { TargetColumnsSection } from "./TargetsStepTargetColumns";
import { detectFormat } from "@/api/datasets";
import type { TaskType, FoldSource } from "@/types/datasets";
import {
  deriveTaskTypeFromTargets,
  getAggregationMethodAdjustment,
  isTargetTypeModified,
  parseColumnsFromData,
  resetTargetType,
  selectDefaultTarget,
  syncTargetsWithDetectedColumns,
  updateTargetType,
  updateTargetUnit,
  type DetectedColumn,
} from "./TargetsStepLogic";

const TASK_TYPE_LABELS: Record<TaskType, string> = {
  auto: "Auto",
  regression: "Regression",
  classification: "Classification",
  binary_classification: "Binary",
  multiclass_classification: "Multiclass",
};

const AGGREGATION_METHOD_OPTIONS = [
  { value: "mean", label: "Mean" },
  { value: "median", label: "Median" },
  { value: "vote", label: "Vote" },
];

const FOLD_SOURCE_OPTIONS: { value: FoldSource; label: string }[] = [
  { value: "none", label: "No cross-validation folds" },
  { value: "column", label: "From column in metadata" },
  { value: "file", label: "From external file" },
];

export function TargetsStep() {
  const { state, dispatch } = useWizard();
  const [showAggregation, setShowAggregation] = useState(state.aggregation.enabled);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detectedColumns, setDetectedColumns] = useState<DetectedColumn[]>([]);
  const aggregationColumnWarning = getRepeatIndexColumnWarning(state.aggregation.column);

  // Load target columns from Y file
  const loadTargetColumns = useCallback(async () => {
    const yFiles = state.files.filter((f) => f.type === "Y");
    if (yFiles.length === 0) {
      setDetectedColumns([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const yFile = yFiles[0];

      // Get effective parsing for Y file (wizard params merged with per-file overrides)
      const yOverrides = state.perFileOverrides[yFile.path] || {};
      const effectiveDelimiter = yOverrides.delimiter || state.parsing?.delimiter || ";";
      const effectiveDecimalSep = yOverrides.decimal_separator || state.parsing?.decimal_separator || ".";

      // Web mode: use File objects directly with effective parsing params
      if (!state.basePath && state.fileBlobs.size > 0) {
        const fileBlob = state.fileBlobs.get(yFile.path);
        if (fileBlob) {
          const text = await fileBlob.text();
          const lines = text.split(/\r?\n/).filter((l) => l.trim());
          if (lines.length > 0) {
            const rows = lines.slice(0, 101).map((line) => line.split(effectiveDelimiter));

            if (rows.length > 1) {
              const headerRow = rows[0];
              const dataRows = rows.slice(1);
              setDetectedColumns(parseColumnsFromData(headerRow, dataRows, effectiveDecimalSep));
              return;
            }
          }
        }
        setError("Could not read Y file content");
        return;
      }

      // Desktop mode: use backend API with effective parsing params
      const result = await detectFormat({ path: yFile.path, sample_rows: 100, delimiter: effectiveDelimiter, decimal_separator: effectiveDecimalSep });

      // Prefer column_info from backend (uses nirs4all's detect_task_type)
      if (result.column_info && result.column_info.length > 0) {
        const cols: DetectedColumn[] = result.column_info.map((col) => ({
          name: col.name,
          type: col.data_type === "numeric" ? "numeric" as const : "text" as const,
          unique_values: col.unique_values,
          min: col.min,
          max: col.max,
          mean: col.mean,
          inferred_task_type: (col.task_type || "regression") as TaskType,
        }));
        setDetectedColumns(cols);
      } else if (result.column_names && result.column_names.length > 0 && result.sample_data) {
        // Fallback: parse sample_data ourselves
        const decimalSep = result.detected_decimal || state.parsing?.decimal_separator || ".";
        const cols = parseColumnsFromData(result.column_names, result.sample_data, decimalSep);
        setDetectedColumns(cols);
      } else {
        // No columns detected
        setDetectedColumns([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to detect columns");
    } finally {
      setLoading(false);
    }
  }, [state.files, state.basePath, state.fileBlobs, state.parsing, state.perFileOverrides]);

  // Load columns when Y files change
  useEffect(() => {
    const yFiles = state.files.filter((f) => f.type === "Y");
    if (yFiles.length > 0) {
      loadTargetColumns();
    } else {
      setDetectedColumns([]);
    }
  }, [state.files, loadTargetColumns]);

  // Auto-sync targets from detected columns
  useEffect(() => {
    if (detectedColumns.length === 0) return;

    const targetSync = syncTargetsWithDetectedColumns(
      detectedColumns,
      state.targets,
      state.defaultTarget,
      state.taskType
    );
    if (targetSync.targetCandidates.length === 0) return;

    if (targetSync.targetsChanged) {
      dispatch({ type: "SET_TARGETS", payload: targetSync.targets });
    }
    if (targetSync.defaultTargetChanged && targetSync.defaultTarget) {
      dispatch({ type: "SET_DEFAULT_TARGET", payload: targetSync.defaultTarget });
    }
    if (targetSync.taskTypeChanged && targetSync.taskType) {
      dispatch({ type: "SET_TASK_TYPE", payload: targetSync.taskType });
    }
  }, [detectedColumns, state.targets, state.defaultTarget, state.taskType, dispatch]);

  // Auto-update aggregation method when task type changes
  useEffect(() => {
    const nextMethod = getAggregationMethodAdjustment(
      state.taskType,
      state.aggregation.enabled,
      state.aggregation.method
    );
    if (nextMethod) {
      dispatch({ type: "SET_AGGREGATION", payload: { method: nextMethod } });
    }
  }, [state.taskType, state.aggregation.enabled, state.aggregation.method, dispatch]);

  const handleTargetTypeChange = (column: string, type: TaskType) => {
    const updatedTargets = updateTargetType(state.targets, column, type);
    dispatch({ type: "SET_TARGETS", payload: updatedTargets });

    const taskType = deriveTaskTypeFromTargets(updatedTargets);
    if (taskType) {
      dispatch({ type: "SET_TASK_TYPE", payload: taskType });
    }
  };

  const handleTargetUnitChange = (column: string, unit: string) => {
    dispatch({
      type: "SET_TARGETS",
      payload: updateTargetUnit(state.targets, column, unit),
    });
  };

  const handleSetDefaultTarget = (column: string) => {
    dispatch({ type: "SET_DEFAULT_TARGET", payload: column });
    dispatch({
      type: "SET_TARGETS",
      payload: selectDefaultTarget(state.targets, column),
    });
  };

  const handleResetTargetType = (columnName: string) => {
    dispatch({
      type: "SET_TARGETS",
      payload: resetTargetType(state.targets, detectedColumns, columnName),
    });
  };

  const isTypeModified = (columnName: string, currentType: TaskType): boolean => {
    return isTargetTypeModified(detectedColumns, columnName, currentType);
  };

  const hasTargetFile = state.files.some((file) => file.type === "Y");

  return (
    <div className="flex-1 flex flex-col gap-4 py-2">
      <TargetColumnsSection
        detectedColumns={detectedColumns}
        targets={state.targets}
        defaultTarget={state.defaultTarget}
        loading={loading}
        error={error}
        hasTargetFile={hasTargetFile}
        onRefresh={loadTargetColumns}
        onTargetTypeChange={handleTargetTypeChange}
        onTargetUnitChange={handleTargetUnitChange}
        onSetDefaultTarget={handleSetDefaultTarget}
        onResetTargetType={handleResetTargetType}
        isTypeModified={isTypeModified}
      />

      {/* Aggregation Settings */}
      <Collapsible open={showAggregation} onOpenChange={setShowAggregation}>
        <div className="border rounded-lg">
          <div className="flex items-center justify-between w-full px-4 py-3 hover:bg-muted/30">
            <CollapsibleTrigger asChild>
              <div className="flex items-center gap-2 cursor-pointer flex-1">
                <Repeat className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">Repetition</span>
                <Badge variant="outline" className="text-[10px]">Optional</Badge>
              </div>
            </CollapsibleTrigger>
            <Switch
              checked={state.aggregation.enabled}
              onCheckedChange={(v) => {
                dispatch({ type: "SET_AGGREGATION", payload: { enabled: v } });
                setShowAggregation(v);
              }}
            />
          </div>

          <CollapsibleContent>
            {state.aggregation.enabled && (
              <div className="px-4 pb-4 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Group repeated measurements of the same physical sample. Choose the metadata column whose repeated rows belong to the same biological sample, not the column containing repetition numbers like 1/2/3.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Sample Group Column</Label>
                    {state.metadataColumns.length > 0 ? (
                      <Select
                        value={state.aggregation.column || ""}
                        onValueChange={(v) => dispatch({ type: "SET_AGGREGATION", payload: { column: v } })}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem disabled value="__meta_header__" className="text-xs font-semibold text-muted-foreground">Metadata columns</SelectItem>
                          {state.metadataColumns.map((col) => (
                            <SelectItem key={`m:${col}`} value={col}>{col}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={state.aggregation.column || ""}
                        onChange={(e) => dispatch({ type: "SET_AGGREGATION", payload: { column: e.target.value } })}
                        placeholder="sample_id"
                        className="h-8"
                      />
                    )}
                    {aggregationColumnWarning && (
                      <p className="mt-2 text-xs text-amber-600">
                        {aggregationColumnWarning}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Method</Label>
                    <Select
                      value={state.aggregation.method}
                      onValueChange={(v) => dispatch({ type: "SET_AGGREGATION", payload: { method: v as "mean" | "median" | "vote" } })}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {AGGREGATION_METHOD_OPTIONS.filter((opt) => {
                          const isClassification = state.taskType.includes("classification");
                          return isClassification ? opt.value === "vote" : opt.value !== "vote";
                        }).map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Cross-Validation Folds */}
      {state.hasFoldFile && (
        <Accordion type="multiple">
          <AccordionItem value="folds" className="border rounded-lg">
            <AccordionTrigger className="px-4 py-3 hover:no-underline">
              <div className="flex items-center gap-2 text-sm">
                <Repeat className="h-4 w-4 text-muted-foreground" />
                <span>Cross-Validation Folds</span>
                <Badge variant="secondary" className="text-[10px]">Detected</Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4">
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Fold file detected{state.foldFilePath && `: ${state.foldFilePath.split(/[/\\]/).pop()}`}
                </p>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Source</Label>
                  <Select
                    value={state.folds?.source || "file"}
                    onValueChange={(v) => dispatch({ type: "SET_FOLDS", payload: v === "none" ? null : { source: v as FoldSource } })}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FOLD_SOURCE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {state.folds?.source === "column" && (
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Column</Label>
                    <Input
                      value={state.folds?.column || ""}
                      onChange={(e) => dispatch({ type: "SET_FOLDS", payload: { ...state.folds!, column: e.target.value } })}
                      placeholder="cv_fold"
                      className="h-8"
                    />
                  </div>
                )}
                {state.folds?.source === "file" && (
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">File</Label>
                    <Input
                      value={state.folds?.file || state.foldFilePath || ""}
                      onChange={(e) => dispatch({ type: "SET_FOLDS", payload: { ...state.folds!, file: e.target.value } })}
                      placeholder="path/to/folds.csv"
                      className="h-8"
                    />
                  </div>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
    </div>
  );
}
