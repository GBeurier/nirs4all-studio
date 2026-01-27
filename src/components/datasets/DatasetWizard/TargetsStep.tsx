/**
 * Step 4: Target & Metadata Configuration
 *
 * Displays auto-detected columns with their inferred types.
 * Allows overriding task type per column.
 */
import { useState, useEffect, useCallback } from "react";
import {
  Layers,
  Settings,
  AlertCircle,
  Info,
  Loader2,
  RefreshCw,
  RotateCcw,
  Repeat,
  Star,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useWizard } from "./WizardContext";
import { detectFormat } from "@/api/client";
import type { TaskType, TargetConfig, FoldSource } from "@/types/datasets";

const TASK_TYPE_LABELS: Record<TaskType, string> = {
  auto: "Auto",
  regression: "Regression",
  binary_classification: "Binary",
  multiclass_classification: "Multiclass",
};

const AGGREGATION_METHOD_OPTIONS = [
  { value: "mean", label: "Mean" },
  { value: "median", label: "Median" },
  { value: "vote", label: "Vote" },
];

const COMMON_UNITS = ["%", "mg/L", "g/L", "ppm", "ppb", "mg/kg", "g/100g", "°Brix", "pH", "mS/cm"];

const FOLD_SOURCE_OPTIONS: { value: FoldSource; label: string }[] = [
  { value: "none", label: "No cross-validation folds" },
  { value: "column", label: "From column in metadata" },
  { value: "file", label: "From external file" },
];

// Detected column from Y file
interface DetectedColumn {
  name: string;
  type: "numeric" | "categorical" | "text";
  unique_values?: number;
  min?: number;
  max?: number;
  mean?: number;
  classes?: string[];
  inferred_task_type: TaskType;
}

export function TargetsStep() {
  const { state, dispatch } = useWizard();
  const [showAggregation, setShowAggregation] = useState(state.aggregation.enabled);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detectedColumns, setDetectedColumns] = useState<DetectedColumn[]>([]);

  // Parse columns from response data
  // Note: sampleData contains actual data rows (headers are in columnNames)
  const parseColumnsFromData = useCallback((
    columnNames: string[],
    sampleData: string[][],
    decimalSeparator: string = "."
  ): DetectedColumn[] => {
    if (!columnNames || columnNames.length === 0) return [];

    // Try to parse a value as number (handles both . and , as decimal)
    const tryParseNumber = (v: string): number | null => {
      if (!v || v.trim() === "") return null;
      const trimmed = v.trim();
      // Try as-is first
      let num = parseFloat(trimmed);
      if (!isNaN(num)) return num;
      // Try with comma as decimal
      num = parseFloat(trimmed.replace(",", "."));
      if (!isNaN(num)) return num;
      // Try with dot as decimal (in case of thousand separator issues)
      num = parseFloat(trimmed.replace(/\s/g, "").replace(",", "."));
      if (!isNaN(num)) return num;
      return null;
    };

    return columnNames.map((colName, idx) => {
      // sampleData is pure data (no header row), so don't skip first row
      const sampleValues = (sampleData || [])
        .map((row) => row?.[idx])
        .filter((v): v is string => v !== null && v !== undefined && v !== "");

      // Count how many values are numeric
      const numericResults = sampleValues.map((v) => tryParseNumber(v));
      const numericValues = numericResults.filter((n): n is number => n !== null);

      // Consider numeric if >= 50% are valid numbers (more lenient)
      const isNumeric = sampleValues.length > 0 && numericValues.length >= sampleValues.length * 0.5;
      const uniqueCount = new Set(sampleValues).size;

      let colType: "numeric" | "categorical" | "text" = "text";
      let classes: string[] | undefined;
      let min: number | undefined;
      let max: number | undefined;
      let mean: number | undefined;

      if (isNumeric) {
        colType = "numeric";
        if (numericValues.length > 0) {
          min = Math.min(...numericValues);
          max = Math.max(...numericValues);
          mean = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
        }
      } else if (uniqueCount <= 10 && uniqueCount > 0) {
        colType = "categorical";
        classes = [...new Set(sampleValues)] as string[];
      }

      // Determine task type with better heuristics for numeric data
      let inferredTaskType: TaskType;
      if (colType === "numeric") {
        // Check if values look like continuous data or class labels
        const isAllIntegers = numericValues.every((v) => Number.isInteger(v));
        const hasSignificantDecimals = numericValues.some((v) => {
          const fractional = Math.abs(v % 1);
          return fractional > 0.001 && fractional < 0.999;
        });
        const range = (max ?? 0) - (min ?? 0);

        // Continuous regression indicators:
        // - Values have decimal parts (e.g., 7.671643)
        // - Wide value range (> 10)
        // - Not all integers with small count
        if (hasSignificantDecimals || range > 10) {
          inferredTaskType = "regression";
        } else if (isAllIntegers && uniqueCount <= 10 && (max ?? 0) <= 10) {
          // Likely ordinal/classification: small integer values (e.g., 0-5 rating)
          inferredTaskType = uniqueCount === 2 ? "binary_classification" : "multiclass_classification";
        } else {
          inferredTaskType = "regression";
        }
      } else if (colType === "categorical") {
        inferredTaskType = uniqueCount === 2 ? "binary_classification" : "multiclass_classification";
      } else {
        inferredTaskType = "regression";
      }

      return {
        name: String(colName),
        type: colType,
        unique_values: uniqueCount,
        min,
        max,
        mean,
        classes,
        inferred_task_type: inferredTaskType,
      };
    });
  }, []);

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

      // Web mode: use File objects directly
      if (!state.basePath && state.fileBlobs.size > 0) {
        const fileBlob = state.fileBlobs.get(yFile.path);
        if (fileBlob) {
          const text = await fileBlob.text();
          const lines = text.split(/\r?\n/).filter((l) => l.trim());
          if (lines.length > 0) {
            const delimiters = [";", ",", "\t", "|"];
            const delimiterCounts = delimiters.map((d) => ({ d, count: lines[0].split(d).length }));
            const bestDelim = delimiterCounts.reduce((a, b) => (a.count > b.count ? a : b)).d;
            const rows = lines.slice(0, 101).map((line) => line.split(bestDelim));

            if (rows.length > 1) {
              // rows[0] = header, rows[1:] = data
              const headerRow = rows[0];
              const dataRows = rows.slice(1); // Use all available data rows for better detection

              let decimalSep = ".";
              if (bestDelim !== ",") {
                const allValues = dataRows.flat().join(" ");
                const commaDecimals = (allValues.match(/\d+,\d+/g) || []).length;
                const dotDecimals = (allValues.match(/\d+\.\d+/g) || []).length;
                if (commaDecimals > dotDecimals) decimalSep = ",";
              }
              setDetectedColumns(parseColumnsFromData(headerRow, dataRows, decimalSep));
              return;
            }
          }
        }
        setError("Could not read Y file content");
        return;
      }

      // Desktop mode: use backend API with nirs4all detection
      const result = await detectFormat({ path: yFile.path, sample_rows: 100 });

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
  }, [state.files, state.basePath, state.fileBlobs, state.parsing, parseColumnsFromData]);

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

    const targetCandidates = detectedColumns.filter((c) => c.type !== "text");
    if (targetCandidates.length === 0) return;

    // Create targets for all target candidates, preserving existing overrides
    const newTargets: TargetConfig[] = targetCandidates.map((col) => {
      const existing = state.targets.find((t) => t.column === col.name);
      return existing || {
        column: col.name,
        type: col.inferred_task_type,
        classes: col.classes,
        is_default: false,
      };
    });

    // Set first as default if no default exists
    const hasDefault = newTargets.some((t) => t.is_default);
    if (!hasDefault && newTargets.length > 0) {
      newTargets[0].is_default = true;
    }

    // Only update if different
    const currentCols = state.targets.map((t) => t.column).sort().join(",");
    const newCols = newTargets.map((t) => t.column).sort().join(",");
    if (currentCols !== newCols) {
      dispatch({ type: "SET_TARGETS", payload: newTargets });
      const defaultTarget = newTargets.find((t) => t.is_default);
      if (defaultTarget) {
        dispatch({ type: "SET_DEFAULT_TARGET", payload: defaultTarget.column });
      }
    }
  }, [detectedColumns, state.targets, dispatch]);

  // Auto-update aggregation method when task type changes
  useEffect(() => {
    if (!state.aggregation.enabled) return;
    const isClassification = state.taskType.includes("classification");
    const currentMethod = state.aggregation.method;

    if (isClassification && currentMethod !== "vote") {
      dispatch({ type: "SET_AGGREGATION", payload: { method: "vote" } });
    } else if (!isClassification && currentMethod === "vote") {
      dispatch({ type: "SET_AGGREGATION", payload: { method: "mean" } });
    }
  }, [state.taskType, state.aggregation.enabled, state.aggregation.method, dispatch]);

  const handleTargetTypeChange = (column: string, type: TaskType) => {
    dispatch({
      type: "SET_TARGETS",
      payload: state.targets.map((t) => (t.column === column ? { ...t, type } : t)),
    });
  };

  const handleTargetUnitChange = (column: string, unit: string) => {
    dispatch({
      type: "SET_TARGETS",
      payload: state.targets.map((t) => (t.column === column ? { ...t, unit } : t)),
    });
  };

  const handleSetDefaultTarget = (column: string) => {
    dispatch({ type: "SET_DEFAULT_TARGET", payload: column });
    dispatch({
      type: "SET_TARGETS",
      payload: state.targets.map((t) => ({ ...t, is_default: t.column === column })),
    });
  };

  const handleResetTargetType = (columnName: string) => {
    const detectedCol = detectedColumns.find((c) => c.name === columnName);
    if (detectedCol) {
      dispatch({
        type: "SET_TARGETS",
        payload: state.targets.map((t) =>
          t.column === columnName
            ? { ...t, type: detectedCol.inferred_task_type, classes: detectedCol.classes }
            : t
        ),
      });
    }
  };

  const isTypeModified = (columnName: string, currentType: TaskType): boolean => {
    const detectedCol = detectedColumns.find((c) => c.name === columnName);
    return detectedCol ? detectedCol.inferred_task_type !== currentType : false;
  };

  // All columns that can be targets (numeric or categorical)
  const targetCandidates = detectedColumns.filter((c) => c.type !== "text");

  return (
    <div className="flex-1 flex flex-col gap-4 py-2">
      {/* Target Columns Section */}
      <div className="flex-1 min-h-0 flex flex-col border rounded-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">Target Columns</span>
          </div>
          {state.files.some((f) => f.type === "Y") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={loadTargetColumns}
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

        {/* Content */}
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
              <Button variant="outline" size="sm" onClick={loadTargetColumns} className="h-7 text-xs">
                <RefreshCw className="h-3 w-3 mr-1" />
                Retry
              </Button>
            </div>
          )}

          {!loading && !error && detectedColumns.length > 0 && (
            <div className="divide-y">
              {/* Table Header */}
              <div className="grid grid-cols-[1fr,100px,110px,70px] gap-2 px-4 py-2 text-xs text-muted-foreground bg-muted/20 font-medium">
                <span>Column</span>
                <span>Detected</span>
                <span>Task Type</span>
                <span className="text-center">Unit</span>
              </div>

              {/* Table Rows - show ALL detected columns */}
              {detectedColumns.map((column) => {
                const isTargetCandidate = column.type !== "text";
                const targetConfig = state.targets.find((t) => t.column === column.name);
                const currentType = targetConfig?.type || column.inferred_task_type;
                const isModified = isTypeModified(column.name, currentType);
                const isDefault = state.defaultTarget === column.name;

                return (
                  <div
                    key={column.name}
                    className={`grid grid-cols-[1fr,100px,110px,70px] gap-2 px-4 py-2.5 items-center hover:bg-muted/30 ${!isTargetCandidate ? "opacity-50" : ""}`}
                  >
                    {/* Column Name */}
                    <div className="flex items-center gap-2 min-w-0">
                      {targetCandidates.length > 1 && isTargetCandidate && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => handleSetDefaultTarget(column.name)}
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

                    {/* Detected Type */}
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

                    {/* Task Type Selector - only for target candidates */}
                    <div className="flex items-center gap-1">
                      {isTargetCandidate ? (
                        <>
                          <Select value={currentType} onValueChange={(v) => handleTargetTypeChange(column.name, v as TaskType)}>
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
                                  onClick={() => handleResetTargetType(column.name)}
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

                    {/* Unit (for regression) */}
                    <div className="flex justify-center">
                      {isTargetCandidate && currentType === "regression" ? (
                        <Select
                          value={targetConfig?.unit || "__none__"}
                          onValueChange={(v) => handleTargetUnitChange(column.name, v === "__none__" ? "" : v)}
                        >
                          <SelectTrigger className="h-7 text-xs px-2 w-full">
                            <SelectValue placeholder="—" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">None</SelectItem>
                            {COMMON_UNITS.map((u) => (
                              <SelectItem key={u} value={u}>{u}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!loading && !error && detectedColumns.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Info className="h-5 w-5 mb-2" />
              <span className="text-sm">
                {state.files.some((f) => f.type === "Y")
                  ? "No columns detected in Y file"
                  : "Map a file as 'Y' (Targets) to detect columns"}
              </span>
            </div>
          )}
        </div>

        {/* Footer info */}
        {detectedColumns.length > 0 && (
          <div className="px-4 py-2 border-t bg-muted/20 text-xs text-muted-foreground">
            {detectedColumns.length} column{detectedColumns.length > 1 ? "s" : ""} detected
            {targetCandidates.length > 0 && <> · {targetCandidates.length} target{targetCandidates.length > 1 ? "s" : ""}</>}
            {targetCandidates.length > 1 && (
              <> · <Star className="h-3 w-3 inline text-amber-500 fill-amber-500" /> = default</>
            )}
          </div>
        )}
      </div>

      {/* Aggregation Settings */}
      <Collapsible open={showAggregation} onOpenChange={setShowAggregation}>
        <div className="border rounded-lg">
          <div className="flex items-center justify-between w-full px-4 py-3 hover:bg-muted/30">
            <CollapsibleTrigger asChild>
              <div className="flex items-center gap-2 cursor-pointer flex-1">
                <Settings className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">Aggregation</span>
                <Badge variant="outline" className="text-[10px]">Optional</Badge>
              </div>
            </CollapsibleTrigger>
            <Switch
              checked={state.aggregation.enabled}
              onCheckedChange={(v) => {
                dispatch({ type: "SET_AGGREGATION", payload: { enabled: v } });
                if (v) setShowAggregation(true);
              }}
            />
          </div>

          <CollapsibleContent>
            {state.aggregation.enabled && (
              <div className="px-4 pb-4 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Combine predictions from multiple spectra of the same sample.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Column</Label>
                    {state.metadataColumns.length > 0 || state.targets.length > 0 ? (
                      <Select
                        value={state.aggregation.column || ""}
                        onValueChange={(v) => dispatch({ type: "SET_AGGREGATION", payload: { column: v } })}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                          {(state.metadataColumns.length > 0 ? state.metadataColumns : state.targets.map((t) => t.column)).map((col) => (
                            <SelectItem key={col} value={col}>{col}</SelectItem>
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
