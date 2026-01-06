/**
 * Step 4: Target & Metadata Configuration
 *
 * Configure:
 * - Target columns (Y)
 * - Task type (regression/classification)
 * - Aggregation settings
 * - Default target selection
 */
import { useState, useEffect } from "react";
import {
  Target,
  Layers,
  Settings,
  AlertCircle,
  Info,
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
import { useWizard } from "./WizardContext";
import type { TaskType, TargetConfig } from "@/types/datasets";

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

// Mock detected columns - in real implementation this would come from preview
interface DetectedColumn {
  name: string;
  type: "numeric" | "categorical" | "text";
  unique_values?: number;
  sample_values?: (string | number)[];
  is_target_candidate: boolean;
  is_metadata_candidate: boolean;
}

export function TargetsStep() {
  const { state, dispatch } = useWizard();
  const [showAggregation, setShowAggregation] = useState(
    state.aggregation.enabled
  );

  // Simulated detected columns (would come from backend in real implementation)
  const [detectedColumns, setDetectedColumns] = useState<DetectedColumn[]>([]);

  useEffect(() => {
    // Simulate column detection from Y files
    if (state.files.some((f) => f.type === "Y")) {
      // Mock columns - in production, this would be fetched
      setDetectedColumns([
        {
          name: "protein",
          type: "numeric",
          is_target_candidate: true,
          is_metadata_candidate: false,
          sample_values: [12.3, 14.5, 11.2],
        },
        {
          name: "moisture",
          type: "numeric",
          is_target_candidate: true,
          is_metadata_candidate: false,
          sample_values: [8.1, 9.2, 7.8],
        },
        {
          name: "quality",
          type: "categorical",
          unique_values: 3,
          is_target_candidate: true,
          is_metadata_candidate: true,
          sample_values: ["A", "B", "C"],
        },
      ]);
    }
  }, [state.files]);

  // Initialize targets from detected columns if empty
  useEffect(() => {
    if (state.targets.length === 0 && detectedColumns.length > 0) {
      const targetCandidates = detectedColumns.filter(
        (c) => c.is_target_candidate
      );
      if (targetCandidates.length === 1) {
        // Auto-select single target
        const col = targetCandidates[0];
        dispatch({
          type: "SET_TARGETS",
          payload: [
            {
              column: col.name,
              type: col.type === "numeric" ? "regression" : "multiclass_classification",
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
      const newTarget: TargetConfig = {
        column: column.name,
        type: column.type === "numeric" ? "regression" : "multiclass_classification",
        classes: column.type === "categorical" ? column.sample_values as string[] : undefined,
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

  return (
    <div className="flex-1 overflow-hidden flex flex-col gap-4 py-2">
      {/* Task Type */}
      <div className="border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-4">
          <Target className="h-4 w-4 text-muted-foreground" />
          <Label className="text-base font-medium">Task Type</Label>
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
          {state.targets.length > 1 && (
            <Badge variant="outline">
              {state.targets.length} targets selected
            </Badge>
          )}
        </div>

        <ScrollArea className="flex-1">
          {detectedColumns.length > 0 ? (
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
                      className="p-3 hover:bg-muted/30 flex items-center gap-3"
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => handleTargetToggle(column)}
                      />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
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
                            <Badge variant="outline" className="text-xs">
                              Default
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {column.sample_values?.slice(0, 3).join(", ")}
                          {column.unique_values && ` (${column.unique_values} unique)`}
                        </div>
                      </div>

                      {isSelected && targetConfig && (
                        <Select
                          value={targetConfig.type}
                          onValueChange={(v) =>
                            handleTargetTypeChange(column.name, v as TaskType)
                          }
                        >
                          <SelectTrigger className="w-[160px] h-8 text-xs">
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
                      )}

                      {isSelected && state.targets.length > 1 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs"
                          onClick={() =>
                            dispatch({
                              type: "SET_DEFAULT_TARGET",
                              payload: column.name,
                            })
                          }
                          disabled={state.defaultTarget === column.name}
                        >
                          Set Default
                        </Button>
                      )}
                    </div>
                  );
                })}
            </div>
          ) : (
            <div className="p-8 text-center">
              <div className="flex items-center justify-center gap-2 text-muted-foreground mb-2">
                <Info className="h-4 w-4" />
                <span>No target columns detected</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Target columns will be detected when you load the dataset preview.
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
    </div>
  );
}
