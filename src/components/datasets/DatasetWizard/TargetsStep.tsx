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
  Target,
  Layers,
  Settings,
  AlertCircle,
  Info,
  Loader2,
  RefreshCw,
  Pencil,
  Split,
  Repeat,
  GitBranch,
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
import { Slider } from "@/components/ui/slider";
import { useWizard } from "./WizardContext";
import { detectFormat } from "@/api/client";
import type { TaskType, TargetConfig, PartitionMethod, FoldSource } from "@/types/datasets";

const TASK_TYPE_OPTIONS: { value: TaskType; label: string; description: string }[] = [
  {
    value: "auto",
    label: "Auto-detect",
    description: "Automatically determine task type from data",
  },
  {
    value: "regression",
    label: "Regression",
    description: "Predict continuous numeric values",
  },
  {
    value: "binary_classification",
    label: "Binary Classification",
    description: "Predict one of two classes",
  },
  {
    value: "multiclass_classification",
    label: "Multiclass Classification",
    description: "Predict one of multiple classes",
  },
];

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

const PARTITION_METHOD_OPTIONS: { value: PartitionMethod; label: string; description: string }[] = [
  { value: "files", label: "File-based", description: "Use file mapping from previous step" },
  { value: "column", label: "Column-based", description: "Split based on a column value" },
  { value: "percentage", label: "Percentage", description: "Random split by percentage" },
  { value: "stratified", label: "Stratified", description: "Stratified split maintaining class proportions" },
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
      // Get the first Y file for detection
      const yFile = yFiles[0];
      const result = await detectFormat({
        path: yFile.path,
        sample_rows: 100,
      });

      if (result.column_names && result.sample_data) {
        const columns: DetectedColumn[] = result.column_names.map((colName, idx) => {
          // Get sample values for this column
          const sampleValues = result.sample_data
            ?.slice(1)
            .map((row) => row[idx])
            .filter((v) => v !== null && v !== undefined && v !== "");

          // Detect column type
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

        setDetectedColumns(columns);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to detect columns";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [state.files]);

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
    <div className="flex-1 overflow-hidden flex flex-col gap-4 py-2">
      {/* Task Type */}
      <div className="border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-4">
          <Target className="h-4 w-4 text-muted-foreground" />
          <Label className="text-base font-medium">Global Task Type</Label>
          <Badge variant="outline" className="text-xs">Optional</Badge>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {TASK_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => dispatch({ type: "SET_TASK_TYPE", payload: opt.value })}
              className={`
                p-3 rounded-lg border text-left transition-colors
                ${
                  state.taskType === opt.value
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }
              `}
            >
              <div className="font-medium text-sm">{opt.label}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {opt.description}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Target Columns */}
      <div className="flex-1 overflow-hidden flex flex-col border rounded-lg">
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

        {/* Selected targets summary */}
        {state.targets.length > 0 && (
          <div className="p-3 border-t bg-muted/30">
            <div className="text-xs text-muted-foreground mb-2">
              Selected targets:
            </div>
            <div className="flex flex-wrap gap-2">
              {state.targets.map((target) => (
                <Badge
                  key={target.column}
                  variant={target.is_default ? "default" : "outline"}
                  className="text-xs"
                >
                  {target.column}
                  {target.unit && ` (${target.unit})`}
                  <span className="ml-1 opacity-60">
                    • {target.type === "regression" ? "reg" : "cls"}
                  </span>
                </Badge>
              ))}
            </div>
          </div>
        )}
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
                  </div>

                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">
                      Aggregation Method
                    </Label>
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
                        {AGGREGATION_METHOD_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={state.aggregation.exclude_outliers}
                    onCheckedChange={(v) =>
                      dispatch({
                        type: "SET_AGGREGATION",
                        payload: { exclude_outliers: v as boolean },
                      })
                    }
                  />
                  <Label className="text-sm cursor-pointer">
                    Exclude outliers before aggregation (Hotelling T²)
                  </Label>
                </div>
              </div>
            )}
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Advanced Configuration Accordions */}
      <Accordion type="multiple" className="space-y-2">
        {/* Partition Configuration */}
        <AccordionItem value="partition" className="border rounded-lg">
          <AccordionTrigger className="px-4 py-3 hover:no-underline">
            <div className="flex items-center gap-2 text-sm">
              <Split className="h-4 w-4 text-muted-foreground" />
              <span>Partition Configuration</span>
              <Badge variant="outline" className="ml-2 text-xs font-normal">
                Optional
              </Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            <div className="space-y-4">
              <div className="flex items-start gap-2 p-3 bg-muted/30 rounded-lg">
                <Info className="h-4 w-4 text-muted-foreground mt-0.5" />
                <p className="text-xs text-muted-foreground">
                  Configure how data is split into training and test sets. By default, the split is based on file mapping from the previous step.
                </p>
              </div>

              {/* Partition Method */}
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">
                  Partition Method
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  {PARTITION_METHOD_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() =>
                        dispatch({ type: "SET_PARTITION", payload: { method: opt.value } })
                      }
                      className={`
                        p-3 rounded-lg border text-left transition-colors
                        ${
                          state.partition.method === opt.value
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50"
                        }
                      `}
                    >
                      <div className="font-medium text-sm">{opt.label}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {opt.description}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Column-based partition options */}
              {state.partition.method === "column" && (
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">
                      Partition Column
                    </Label>
                    <Input
                      value={state.partition.column || ""}
                      onChange={(e) =>
                        dispatch({ type: "SET_PARTITION", payload: { column: e.target.value } })
                      }
                      placeholder="e.g., split"
                      className="h-9"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">
                      Train Values
                    </Label>
                    <Input
                      value={state.partition.train_values?.join(", ") || ""}
                      onChange={(e) =>
                        dispatch({
                          type: "SET_PARTITION",
                          payload: { train_values: e.target.value.split(",").map((s) => s.trim()) },
                        })
                      }
                      placeholder="train, calibration"
                      className="h-9"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">
                      Test Values
                    </Label>
                    <Input
                      value={state.partition.test_values?.join(", ") || ""}
                      onChange={(e) =>
                        dispatch({
                          type: "SET_PARTITION",
                          payload: { test_values: e.target.value.split(",").map((s) => s.trim()) },
                        })
                      }
                      placeholder="test, validation"
                      className="h-9"
                    />
                  </div>
                </div>
              )}

              {/* Percentage-based partition options */}
              {state.partition.method === "percentage" && (
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label className="text-xs text-muted-foreground">
                        Training Percentage
                      </Label>
                      <span className="text-sm font-medium">
                        {state.partition.train_percent || 80}%
                      </span>
                    </div>
                    <Slider
                      value={[state.partition.train_percent || 80]}
                      onValueChange={([v]) =>
                        dispatch({ type: "SET_PARTITION", payload: { train_percent: v } })
                      }
                      min={50}
                      max={95}
                      step={5}
                      className="w-full"
                    />
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={state.partition.shuffle ?? true}
                        onCheckedChange={(v) =>
                          dispatch({ type: "SET_PARTITION", payload: { shuffle: v as boolean } })
                        }
                      />
                      <Label className="text-sm">Shuffle data</Label>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">
                        Random Seed
                      </Label>
                      <Input
                        type="number"
                        value={state.partition.random_state || 42}
                        onChange={(e) =>
                          dispatch({
                            type: "SET_PARTITION",
                            payload: { random_state: parseInt(e.target.value) || 42 },
                          })
                        }
                        className="h-8 w-24"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Stratified partition options */}
              {state.partition.method === "stratified" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">
                        Stratify By Column
                      </Label>
                      <Input
                        value={state.partition.stratify_column || ""}
                        onChange={(e) =>
                          dispatch({
                            type: "SET_PARTITION",
                            payload: { stratify_column: e.target.value },
                          })
                        }
                        placeholder="target column"
                        className="h-9"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <Label className="text-xs text-muted-foreground">
                          Training Percentage
                        </Label>
                        <span className="text-sm font-medium">
                          {state.partition.train_percent || 70}%
                        </span>
                      </div>
                      <Slider
                        value={[state.partition.train_percent || 70]}
                        onValueChange={([v]) =>
                          dispatch({ type: "SET_PARTITION", payload: { train_percent: v } })
                        }
                        min={50}
                        max={90}
                        step={5}
                        className="w-full"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Cross-Validation Folds */}
        <AccordionItem value="folds" className="border rounded-lg">
          <AccordionTrigger className="px-4 py-3 hover:no-underline">
            <div className="flex items-center gap-2 text-sm">
              <Repeat className="h-4 w-4 text-muted-foreground" />
              <span>Cross-Validation Folds</span>
              <Badge variant="outline" className="ml-2 text-xs font-normal">
                Optional
              </Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            <div className="space-y-4">
              <div className="flex items-start gap-2 p-3 bg-muted/30 rounded-lg">
                <Info className="h-4 w-4 text-muted-foreground mt-0.5" />
                <p className="text-xs text-muted-foreground">
                  Define custom cross-validation folds. If not specified, folds will be generated automatically during training.
                </p>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">
                  Fold Source
                </Label>
                <Select
                  value={state.folds?.source || "none"}
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
                    value={state.folds?.file || ""}
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

        {/* Feature Variations */}
        <AccordionItem value="variations" className="border rounded-lg">
          <AccordionTrigger className="px-4 py-3 hover:no-underline">
            <div className="flex items-center gap-2 text-sm">
              <GitBranch className="h-4 w-4 text-muted-foreground" />
              <span>Feature Variations</span>
              <Badge variant="outline" className="ml-2 text-xs font-normal">
                Advanced
              </Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            <div className="space-y-4">
              <div className="flex items-start gap-2 p-3 bg-muted/30 rounded-lg">
                <Info className="h-4 w-4 text-muted-foreground mt-0.5" />
                <p className="text-xs text-muted-foreground">
                  Configure multiple preprocessed versions of the same spectral data. Useful when comparing raw vs. preprocessed spectra.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  checked={state.variations !== null}
                  onCheckedChange={(v) =>
                    dispatch({
                      type: "SET_VARIATIONS",
                      payload: v ? { mode: "separate", variations: [] } : null,
                    })
                  }
                />
                <Label className="text-sm">Enable feature variations</Label>
              </div>

              {state.variations && (
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">
                    Variation Mode
                  </Label>
                  <Select
                    value={state.variations.mode}
                    onValueChange={(v) =>
                      dispatch({
                        type: "SET_VARIATIONS",
                        payload: { ...state.variations!, mode: v as "separate" | "concat" | "select" | "compare" },
                      })
                    }
                  >
                    <SelectTrigger className="w-full h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="separate">Separate (run each independently)</SelectItem>
                      <SelectItem value="concat">Concatenate (combine features)</SelectItem>
                      <SelectItem value="select">Select (use specific variations)</SelectItem>
                      <SelectItem value="compare">Compare (run and rank by performance)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-2">
                    Variations are configured by mapping files in the File Mapping step with different source assignments.
                  </p>
                </div>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
