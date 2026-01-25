/**
 * Step 4: Target & Metadata Configuration
 *
 * Configure:
 * - Target columns (Y) with multi-select
 * - Task type per target (regression/classification)
 * - Unit per target
 * - Aggregation settings
 * - Default target selection
 */
import { useState, useEffect, useCallback } from "react";
import {
  Layers,
  Settings,
  AlertCircle,
  Info,
  Loader2,
  RefreshCw,
  Pencil,
  Repeat,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useWizard } from "./WizardContext";
import { detectFormat } from "@/api/client";
import type { TaskType, TargetConfig, FoldSource } from "@/types/datasets";

const AGGREGATION_METHOD_OPTIONS = [
  { value: "mean", label: "Mean", description: "Average predictions" },
  { value: "median", label: "Median", description: "Median prediction" },
  { value: "vote", label: "Vote", description: "Majority voting (classification)" },
];

const COMMON_UNITS = [
  "%",
  "mg/L",
  "g/L",
  "ppm",
  "ppb",
  "mg/kg",
  "g/100g",
  "°Brix",
  "pH",
  "mS/cm",
];

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
  sample_values?: (string | number)[];
  is_target_candidate: boolean;
  is_metadata_candidate: boolean;
  min?: number;
  max?: number;
  mean?: number;
  classes?: string[];
}

export function TargetsStep() {
  const { state, dispatch } = useWizard();
  const [showAggregation, setShowAggregation] = useState(
    state.aggregation.enabled
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detected columns from Y files
  const [detectedColumns, setDetectedColumns] = useState<DetectedColumn[]>([]);

  // Parse columns from response data
  const parseColumnsFromData = (columnNames: string[], sampleData: string[][]) => {
    return columnNames.map((colName, idx) => {
      const sampleValues = sampleData
        .slice(1)
        .map((row) => row[idx])
        .filter((v) => v !== null && v !== undefined && v !== "");

      const numericValues = sampleValues?.filter((v) => !isNaN(parseFloat(v)));
      const isNumeric = numericValues && numericValues.length > sampleValues!.length * 0.8;
      const uniqueCount = new Set(sampleValues).size;

      let colType: "numeric" | "categorical" | "text" = "text";
      let classes: string[] | undefined;
      let min: number | undefined;
      let max: number | undefined;
      let mean: number | undefined;

      if (isNumeric) {
        colType = "numeric";
        const nums = numericValues!.map((v) => parseFloat(v));
        min = Math.min(...nums);
        max = Math.max(...nums);
        mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      } else if (uniqueCount <= 10) {
        colType = "categorical";
        classes = [...new Set(sampleValues)] as string[];
      }

      return {
        name: String(colName),
        type: colType,
        unique_values: uniqueCount,
        sample_values: sampleValues?.slice(0, 5) as (string | number)[],
        is_target_candidate: colType !== "text",
        is_metadata_candidate: colType === "text" || colType === "categorical",
        min,
        max,
        mean,
        classes,
      };
    });
  };

  // Load target columns from Y file
  const loadTargetColumns = useCallback(async () => {
    // Find Y files
    const yFiles = state.files.filter((f) => f.type === "Y");
    if (yFiles.length === 0) {
      setDetectedColumns([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const yFile = yFiles[0];

      // Web mode: use File objects directly if basePath is empty
      if (!state.basePath && state.fileBlobs.size > 0) {
        const fileBlob = state.fileBlobs.get(yFile.path);
        if (fileBlob) {
          const text = await fileBlob.text();
          const lines = text.split(/\r?\n/).filter(l => l.trim());
          if (lines.length > 0) {
            // Detect delimiter
            const firstLine = lines[0];
            const delimiters = [";", ",", "\t", "|"];
            const delimiterCounts = delimiters.map(d => ({ d, count: firstLine.split(d).length }));
            const bestDelim = delimiterCounts.reduce((a, b) => a.count > b.count ? a : b).d;

            // Parse CSV
            const rows = lines.slice(0, 101).map(line => line.split(bestDelim));
            if (rows.length > 0) {
              const columnNames = rows[0];
              const sampleData = rows.slice(0, 6);
              const columns = parseColumnsFromData(columnNames, sampleData);
              setDetectedColumns(columns);
              return;
            }
          }
        }
        setError("Could not read Y file content");
        return;
      }

      // Desktop mode: use backend API
      const result = await detectFormat({
        path: yFile.path,
        sample_rows: 100,
      });

      if (result.column_names && result.sample_data) {
        const columns = parseColumnsFromData(result.column_names, result.sample_data);
        setDetectedColumns(columns);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to detect columns";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [state.files, state.basePath, state.fileBlobs]);

  // Load columns when Y files change
  useEffect(() => {
    const yFiles = state.files.filter((f) => f.type === "Y");
    if (yFiles.length > 0) {
      loadTargetColumns();
    } else {
      setDetectedColumns([]);
    }
  }, [state.files, loadTargetColumns]);

  // Initialize targets from detected columns if empty
  useEffect(() => {
    if (state.targets.length === 0 && detectedColumns.length > 0) {
      const targetCandidates = detectedColumns.filter(
        (c) => c.is_target_candidate
      );
      if (targetCandidates.length === 1) {
        // Auto-select single target
        const col = targetCandidates[0];
        const taskType: TaskType = col.type === "numeric" ? "regression" : "multiclass_classification";
        dispatch({
          type: "SET_TARGETS",
          payload: [
            {
              column: col.name,
              type: taskType,
              classes: col.classes,
              is_default: true,
            },
          ],
        });
        dispatch({ type: "SET_DEFAULT_TARGET", payload: col.name });
      }
    }
  }, [detectedColumns, state.targets.length, dispatch]);

  // Auto-update aggregation method when task type changes
  useEffect(() => {
    if (!state.aggregation.enabled) return;

    const isClassification = state.taskType.includes("classification");
    const currentMethod = state.aggregation.method;

    // If classification but method is not "vote", switch to "vote"
    if (isClassification && currentMethod !== "vote") {
      dispatch({
        type: "SET_AGGREGATION",
        payload: { method: "vote" },
      });
    }
    // If regression/auto but method is "vote", switch to "mean"
    else if (!isClassification && currentMethod === "vote") {
      dispatch({
        type: "SET_AGGREGATION",
        payload: { method: "mean" },
      });
    }
  }, [state.taskType, state.aggregation.enabled, state.aggregation.method, dispatch]);

  const handleTargetToggle = (column: DetectedColumn) => {
    const existing = state.targets.find((t) => t.column === column.name);
    if (existing) {
      // Remove target
      const newTargets = state.targets.filter((t) => t.column !== column.name);
      dispatch({ type: "SET_TARGETS", payload: newTargets });
      if (state.defaultTarget === column.name && newTargets.length > 0) {
        dispatch({ type: "SET_DEFAULT_TARGET", payload: newTargets[0].column });
      }
    } else {
      // Add target
      const taskType: TaskType = column.type === "numeric" ? "regression" : "multiclass_classification";
      const newTarget: TargetConfig = {
        column: column.name,
        type: taskType,
        classes: column.classes,
        is_default: state.targets.length === 0,
      };
      dispatch({ type: "SET_TARGETS", payload: [...state.targets, newTarget] });
      if (state.targets.length === 0) {
        dispatch({ type: "SET_DEFAULT_TARGET", payload: column.name });
      }
    }
  };

  const handleTargetTypeChange = (column: string, type: TaskType) => {
    dispatch({
      type: "SET_TARGETS",
      payload: state.targets.map((t) =>
        t.column === column ? { ...t, type } : t
      ),
    });
  };

  const handleTargetUnitChange = (column: string, unit: string) => {
    dispatch({
      type: "SET_TARGETS",
      payload: state.targets.map((t) =>
        t.column === column ? { ...t, unit } : t
      ),
    });
  };

  const handleSetDefaultTarget = (column: string) => {
    dispatch({ type: "SET_DEFAULT_TARGET", payload: column });
    dispatch({
      type: "SET_TARGETS",
      payload: state.targets.map((t) => ({
        ...t,
        is_default: t.column === column,
      })),
    });
  };

  return (
    <div className="flex-1 flex flex-col gap-4 py-2">
      {/* Target Columns */}
      <div className="flex-1 min-h-0 flex flex-col border rounded-lg">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <Label className="text-base font-medium">Target Columns</Label>
          </div>
          <div className="flex items-center gap-2">
            {state.targets.length > 1 && (
              <Badge variant="outline">
                {state.targets.length} targets selected
              </Badge>
            )}
            {state.files.some((f) => f.type === "Y") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={loadTargetColumns}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
        </div>

        <ScrollArea className="flex-1">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">
                Detecting columns...
              </span>
            </div>
          )}

          {error && !loading && (
            <div className="p-4">
              <div className="flex items-center gap-2 text-amber-600 mb-2">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm font-medium">Detection failed</span>
              </div>
              <p className="text-xs text-muted-foreground">{error}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={loadTargetColumns}
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                Retry
              </Button>
            </div>
          )}

          {!loading && !error && detectedColumns.length > 0 && (
            <div className="divide-y">
              {detectedColumns
                .filter((c) => c.is_target_candidate)
                .map((column) => {
                  const isSelected = state.targets.some(
                    (t) => t.column === column.name
                  );
                  const targetConfig = state.targets.find(
                    (t) => t.column === column.name
                  );

                  return (
                    <div
                      key={column.name}
                      className="p-3 hover:bg-muted/30 flex items-start gap-3"
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => handleTargetToggle(column)}
                        className="mt-1"
                      />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">
                            {column.name}
                          </span>
                          <Badge
                            variant={
                              column.type === "numeric" ? "default" : "secondary"
                            }
                            className="text-xs"
                          >
                            {column.type}
                          </Badge>
                          {state.defaultTarget === column.name && (
                            <Badge variant="outline" className="text-xs bg-primary/10">
                              Default
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 space-x-2">
                          {column.type === "numeric" && column.min !== undefined && (
                            <span>
                              Range: {column.min.toFixed(2)} - {column.max?.toFixed(2)}
                            </span>
                          )}
                          {column.type === "categorical" && column.classes && (
                            <span>
                              Classes: {column.classes.slice(0, 3).join(", ")}
                              {column.classes.length > 3 && ` (+${column.classes.length - 3})`}
                            </span>
                          )}
                          {column.unique_values && (
                            <span>({column.unique_values} unique)</span>
                          )}
                        </div>

                        {/* Target configuration row when selected */}
                        {isSelected && targetConfig && (
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            {/* Task type selector */}
                            <Select
                              value={targetConfig.type}
                              onValueChange={(v) =>
                                handleTargetTypeChange(column.name, v as TaskType)
                              }
                            >
                              <SelectTrigger className="w-[140px] h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="regression">Regression</SelectItem>
                                <SelectItem value="binary_classification">
                                  Binary
                                </SelectItem>
                                <SelectItem value="multiclass_classification">
                                  Multiclass
                                </SelectItem>
                              </SelectContent>
                            </Select>

                            {/* Unit input with suggestions */}
                            {targetConfig.type === "regression" && (
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 text-xs gap-1"
                                  >
                                    <Pencil className="h-3 w-3" />
                                    {targetConfig.unit || "Add unit"}
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-48 p-2" align="start">
                                  <div className="space-y-2">
                                    <Input
                                      value={targetConfig.unit || ""}
                                      onChange={(e) =>
                                        handleTargetUnitChange(column.name, e.target.value)
                                      }
                                      placeholder="e.g., %, mg/L"
                                      className="h-8 text-xs"
                                    />
                                    <div className="flex flex-wrap gap-1">
                                      {COMMON_UNITS.map((unit) => (
                                        <Button
                                          key={unit}
                                          variant="ghost"
                                          size="sm"
                                          className="h-6 px-2 text-xs"
                                          onClick={() =>
                                            handleTargetUnitChange(column.name, unit)
                                          }
                                        >
                                          {unit}
                                        </Button>
                                      ))}
                                    </div>
                                  </div>
                                </PopoverContent>
                              </Popover>
                            )}

                            {/* Set as default button */}
                            {state.targets.length > 1 && (
                              <Button
                                variant={state.defaultTarget === column.name ? "secondary" : "ghost"}
                                size="sm"
                                className="h-8 text-xs"
                                onClick={() => handleSetDefaultTarget(column.name)}
                                disabled={state.defaultTarget === column.name}
                              >
                                {state.defaultTarget === column.name ? "✓ Default" : "Set Default"}
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}

          {!loading && !error && detectedColumns.length === 0 && (
            <div className="p-8 text-center">
              <div className="flex items-center justify-center gap-2 text-muted-foreground mb-2">
                <Info className="h-4 w-4" />
                <span>No target columns detected</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {state.files.some((f) => f.type === "Y")
                  ? "Unable to detect columns from the Y file. Targets will be configured when the dataset is loaded."
                  : "Map at least one file as type 'Y' (Targets) in the previous step to configure target columns."}
              </p>
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Aggregation Settings */}
      <Collapsible open={showAggregation} onOpenChange={setShowAggregation}>
        <div className="border rounded-lg">
          <CollapsibleTrigger className="flex items-center justify-between w-full p-4 hover:bg-muted/30">
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-muted-foreground" />
              <Label className="text-base font-medium cursor-pointer">
                Aggregation Settings
              </Label>
              <Badge variant="outline" className="text-xs">
                Optional
              </Badge>
            </div>
            <Switch
              checked={state.aggregation.enabled}
              onCheckedChange={(v) => {
                dispatch({ type: "SET_AGGREGATION", payload: { enabled: v } });
                if (v) setShowAggregation(true);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          </CollapsibleTrigger>

          <CollapsibleContent>
            {state.aggregation.enabled && (
              <div className="p-4 pt-0 space-y-4">
                <div className="flex items-start gap-2 p-3 bg-muted/30 rounded-lg">
                  <Info className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <p className="text-xs text-muted-foreground">
                    Aggregation combines predictions from multiple spectra of the
                    same sample. Useful when you have repeated measurements per
                    biological sample.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">
                      Aggregate By Column
                    </Label>
                    {(() => {
                      // Use metadata columns if available, otherwise fall back to target columns
                      const availableColumns = state.metadataColumns.length > 0
                        ? state.metadataColumns
                        : state.targets.map(t => t.column);

                      if (availableColumns.length > 0) {
                        return (
                          <>
                            <Select
                              value={state.aggregation.column || ""}
                              onValueChange={(v) =>
                                dispatch({
                                  type: "SET_AGGREGATION",
                                  payload: { column: v },
                                })
                              }
                            >
                              <SelectTrigger className="h-9">
                                <SelectValue placeholder="Select column..." />
                              </SelectTrigger>
                              <SelectContent>
                                {availableColumns.map((col) => (
                                  <SelectItem key={col} value={col}>
                                    {col}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {state.metadataColumns.length === 0 && state.targets.length > 0 && (
                              <p className="text-xs text-muted-foreground mt-1">
                                Using target columns (no metadata file detected)
                              </p>
                            )}
                          </>
                        );
                      }

                      return (
                        <Input
                          value={state.aggregation.column || ""}
                          onChange={(e) =>
                            dispatch({
                              type: "SET_AGGREGATION",
                              payload: { column: e.target.value },
                            })
                          }
                          placeholder="e.g., sample_id"
                          className="h-9"
                        />
                      );
                    })()}
                  </div>

                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">
                      Aggregation Method
                    </Label>
                    {(() => {
                      // Filter methods based on task type
                      const isClassification = state.taskType.includes("classification");
                      const filteredMethods = AGGREGATION_METHOD_OPTIONS.filter((opt) => {
                        if (isClassification) {
                          return opt.value === "vote";
                        }
                        // Regression or auto: show mean and median
                        return opt.value === "mean" || opt.value === "median";
                      });

                      return (
                        <Select
                          value={state.aggregation.method}
                          onValueChange={(v) =>
                            dispatch({
                              type: "SET_AGGREGATION",
                              payload: { method: v as "mean" | "median" | "vote" },
                            })
                          }
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {filteredMethods.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      );
                    })()}
                  </div>
                </div>

              </div>
            )}
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Cross-Validation Folds - Only show if fold file was detected */}
      <Accordion type="multiple" className="space-y-2">
        {state.hasFoldFile && (
          <AccordionItem value="folds" className="border rounded-lg">
            <AccordionTrigger className="px-4 py-3 hover:no-underline">
              <div className="flex items-center gap-2 text-sm">
                <Repeat className="h-4 w-4 text-muted-foreground" />
                <span>Cross-Validation Folds</span>
                <Badge variant="secondary" className="ml-2 text-xs font-normal">
                  Detected
                </Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4">
              <div className="space-y-4">
                <div className="flex items-start gap-2 p-3 bg-muted/30 rounded-lg">
                  <Info className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <p className="text-xs text-muted-foreground">
                    A fold file was detected in your dataset folder
                    {state.foldFilePath && `: ${state.foldFilePath.split(/[/\\]/).pop()}`}.
                    Configure how to use it for cross-validation.
                  </p>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">
                    Fold Source
                  </Label>
                  <Select
                    value={state.folds?.source || "file"}
                    onValueChange={(v) =>
                      dispatch({
                        type: "SET_FOLDS",
                        payload: v === "none" ? null : { source: v as FoldSource },
                      })
                    }
                  >
                    <SelectTrigger className="w-full h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FOLD_SOURCE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {state.folds?.source === "column" && (
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">
                      Fold Column
                    </Label>
                    <Input
                      value={state.folds?.column || ""}
                      onChange={(e) =>
                        dispatch({
                          type: "SET_FOLDS",
                          payload: { ...state.folds!, column: e.target.value },
                        })
                      }
                      placeholder="e.g., cv_fold"
                      className="h-9"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Column containing fold assignments (values become validation folds)
                    </p>
                  </div>
                )}

                {state.folds?.source === "file" && (
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">
                      Folds File Path
                    </Label>
                    <Input
                      value={state.folds?.file || state.foldFilePath || ""}
                      onChange={(e) =>
                        dispatch({
                          type: "SET_FOLDS",
                          payload: { ...state.folds!, file: e.target.value },
                        })
                      }
                      placeholder="path/to/folds.csv"
                      className="h-9"
                    />
                  </div>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

      </Accordion>
    </div>
  );
}
