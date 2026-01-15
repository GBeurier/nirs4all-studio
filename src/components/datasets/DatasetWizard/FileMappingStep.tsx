/**
 * Step 2: File Detection & Mapping
 *
 * Shows detected files and allows users to:
 * - Map files to roles (X, Y, metadata)
 * - Assign splits (train, test)
 * - Assign sources for multi-source datasets
 * - Add additional files
 */
import { useState } from "react";
import {
  File,
  Plus,
  X,
  ChevronDown,
  ChevronUp,
  Sparkles,
  AlertCircle,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useWizard } from "./WizardContext";
import { selectFile } from "@/utils/fileDialogs";
import type { DetectedFile } from "@/types/datasets";

// Format file size
function formatSize(bytes: number): string {
  if (bytes === 0) return "—";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

// Get type badge color
function getTypeBadgeVariant(
  type: DetectedFile["type"]
): "default" | "secondary" | "outline" {
  switch (type) {
    case "X":
      return "default";
    case "Y":
      return "secondary";
    case "metadata":
      return "outline";
    default:
      return "outline";
  }
}

interface FileRowProps {
  file: DetectedFile;
  index: number;
  onUpdate: (updates: Partial<DetectedFile>) => void;
  onRemove: () => void;
  maxSource: number;
}

function FileRow({ file, index, onUpdate, onRemove, maxSource }: FileRowProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b last:border-0">
      <div className="p-3 hover:bg-muted/30">
        <div className="flex items-start gap-3">
          <File className="h-4 w-4 text-primary mt-1 flex-shrink-0" />

          <div className="flex-1 min-w-0">
            {/* File name and badges */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm truncate flex-1" title={file.path}>
                {file.filename}
              </span>

              {file.detected && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Badge variant="secondary" className="text-xs">
                        <Sparkles className="h-3 w-3 mr-1" />
                        Auto
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      Auto-detected ({Math.round(file.confidence * 100)}%
                      confidence)
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}

              <Badge variant="outline" className="text-xs uppercase">
                {file.format}
              </Badge>

              <span className="text-xs text-muted-foreground">
                {formatSize(file.size_bytes)}
              </span>

              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                onClick={onRemove}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>

            {/* Main controls row */}
            <div className="grid grid-cols-3 gap-2">
              {/* Type selector */}
              <div>
                <Label className="text-xs text-muted-foreground">Role</Label>
                <Select
                  value={file.type}
                  onValueChange={(v) =>
                    onUpdate({
                      type: v as DetectedFile["type"],
                      source: v === "X" ? (file.source || 1) : null,
                    })
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="X">X (Features/Spectra)</SelectItem>
                    <SelectItem value="Y">Y (Targets/Analyte)</SelectItem>
                    <SelectItem value="metadata">Metadata</SelectItem>
                    <SelectItem value="unknown">Unknown</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Split selector */}
              <div>
                <Label className="text-xs text-muted-foreground">Split</Label>
                <Select
                  value={file.split}
                  onValueChange={(v) =>
                    onUpdate({ split: v as DetectedFile["split"] })
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="train">Train</SelectItem>
                    <SelectItem value="test">Test</SelectItem>
                    <SelectItem value="unknown">Unknown</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Source selector (only for X files) */}
              <div>
                <Label className="text-xs text-muted-foreground">Source</Label>
                {file.type === "X" ? (
                  <Select
                    value={String(file.source || 1)}
                    onValueChange={(v) => onUpdate({ source: parseInt(v) })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: Math.max(maxSource + 1, 5) }, (_, i) => (
                        <SelectItem key={i + 1} value={String(i + 1)}>
                          Source {i + 1}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="h-8 px-3 flex items-center text-xs text-muted-foreground bg-muted/50 rounded-md">
                    N/A
                  </div>
                )}
              </div>
            </div>

            {/* Expanded details */}
            {expanded && (
              <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="font-medium">Full path:</span>
                    <div className="font-mono truncate">{file.path}</div>
                  </div>
                  <div>
                    <span className="font-medium">Format:</span>
                    <div>{file.format.toUpperCase()}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function FileMappingStep() {
  const { state, dispatch } = useWizard();

  // Calculate max source number
  const maxSource = Math.max(
    0,
    ...state.files.filter((f) => f.type === "X").map((f) => f.source || 0)
  );

  // Validation
  const hasXFiles = state.files.some((f) => f.type === "X");
  const hasTrainX = state.files.some((f) => f.type === "X" && f.split === "train");

  const handleAddFiles = async () => {
    try {
      const result = await selectFile(
        ["CSV files (*.csv)", "Excel files (*.xlsx;*.xls)", "All files (*.*)"],
        true
      );

      if (result) {
        const filePaths = Array.isArray(result) ? result : [result];

        const newFiles: DetectedFile[] = filePaths.map((filePath) => {
          const filename = filePath.split(/[/\\]/).pop() || "";
          const lowerName = filename.toLowerCase();

          let format: DetectedFile["format"] = "csv";
          if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
            format = lowerName.endsWith(".xlsx") ? "xlsx" : "xls";
          } else if (lowerName.endsWith(".parquet")) {
            format = "parquet";
          }

          return {
            path: filePath,
            filename,
            type: "unknown" as const,
            split: "train" as const,
            source: null,
            format,
            size_bytes: 0,
            confidence: 0,
            detected: false,
          };
        });

        dispatch({ type: "ADD_FILES", payload: newFiles });
      }
    } catch (error) {
      console.error("Failed to add files:", error);
    }
  };

  const handleUpdateFile = (index: number, updates: Partial<DetectedFile>) => {
    dispatch({ type: "UPDATE_FILE", payload: { index, updates } });
  };

  const handleRemoveFile = (index: number) => {
    dispatch({ type: "REMOVE_FILE", payload: index });
  };

  return (
    <div className="flex-1 overflow-hidden flex flex-col gap-4 py-2">
      {/* Path display */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-sm text-muted-foreground">
            {state.sourceType === "folder" ? "Folder Path" : "Base Path"}
          </Label>
          <div className="flex items-center gap-2">
            <Label className="text-sm text-muted-foreground">Dataset Name</Label>
            <Input
              value={state.datasetName}
              onChange={(e) =>
                dispatch({ type: "SET_DATASET_NAME", payload: e.target.value })
              }
              className="h-7 w-48 text-sm"
              placeholder="Enter dataset name"
            />
          </div>
        </div>
        <div className="px-3 py-2 bg-muted/50 rounded-md text-sm font-mono truncate">
          {state.basePath}
        </div>
      </div>

      {/* Validation warnings */}
      {!hasXFiles && state.files.length > 0 && (
        <div className="flex items-center gap-2 p-3 bg-amber-500/10 text-amber-600 rounded-lg text-sm">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>No feature files (X) detected. At least one X file is required.</span>
        </div>
      )}

      {hasXFiles && !hasTrainX && (
        <div className="flex items-center gap-2 p-3 bg-amber-500/10 text-amber-600 rounded-lg text-sm">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>No training data detected. Consider marking at least one X file as 'Train'.</span>
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <Label>
            Dataset Files{" "}
            <span className="text-muted-foreground">({state.files.length})</span>
          </Label>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleAddFiles}
            className="h-7 text-xs"
          >
            <Plus className="h-3 w-3 mr-1" />
            Add Files
          </Button>
        </div>

        <ScrollArea className="flex-1 border rounded-md">
          {state.files.length > 0 ? (
            state.files.map((file, idx) => (
              <FileRow
                key={file.path}
                file={file}
                index={idx}
                onUpdate={(updates) => handleUpdateFile(idx, updates)}
                onRemove={() => handleRemoveFile(idx)}
                maxSource={maxSource}
              />
            ))
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              <File className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No files detected</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={handleAddFiles}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Files
              </Button>
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Summary */}
      {state.files.length > 0 && (
        <div className="flex gap-4 text-sm text-muted-foreground border-t pt-3">
          <div>
            <span className="font-medium text-foreground">
              {state.files.filter((f) => f.type === "X").length}
            </span>{" "}
            feature files
          </div>
          <div>
            <span className="font-medium text-foreground">
              {state.files.filter((f) => f.type === "Y").length}
            </span>{" "}
            target files
          </div>
          <div>
            <span className="font-medium text-foreground">
              {state.files.filter((f) => f.type === "metadata").length}
            </span>{" "}
            metadata files
          </div>
          <div>
            <span className="font-medium text-foreground">{maxSource}</span>{" "}
            source{maxSource !== 1 ? "s" : ""}
          </div>
        </div>
      )}

      {/* Multi-Source Settings Accordion */}
      {maxSource > 1 && (
        <Accordion type="single" collapsible className="border rounded-lg">
          <AccordionItem value="multi-source" className="border-none">
            <AccordionTrigger className="px-4 py-3 hover:no-underline">
              <div className="flex items-center gap-2 text-sm">
                <Layers className="h-4 w-4 text-muted-foreground" />
                <span>Multi-Source Settings</span>
                <Badge variant="secondary" className="ml-2">
                  {maxSource} sources
                </Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4">
              <div className="space-y-4">
                {/* Source Names */}
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">
                    Source Names
                  </Label>
                  <div className="grid grid-cols-2 gap-2">
                    {Array.from({ length: maxSource }, (_, i) => (
                      <div key={i + 1} className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-16">
                          Source {i + 1}:
                        </span>
                        <Input
                          className="h-8 text-sm"
                          placeholder={`Source ${i + 1}`}
                          value={
                            state.multiSource?.sources?.find((s) => s.id === i + 1)
                              ?.name || ""
                          }
                          onChange={(e) => {
                            const sources = state.multiSource?.sources || [];
                            const existingIndex = sources.findIndex(
                              (s) => s.id === i + 1
                            );
                            const updatedSources = [...sources];

                            if (existingIndex >= 0) {
                              updatedSources[existingIndex] = {
                                ...updatedSources[existingIndex],
                                name: e.target.value,
                              };
                            } else {
                              updatedSources.push({
                                id: i + 1,
                                name: e.target.value,
                                files: [],
                              });
                            }

                            dispatch({
                              type: "SET_MULTI_SOURCE",
                              payload: {
                                ...(state.multiSource || {
                                  sources: [],
                                }),
                                sources: updatedSources,
                              },
                            });
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Link-by Column */}
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">
                    Link-by Column
                  </Label>
                  <Input
                    className="h-9"
                    placeholder="sample_id (column to link samples across sources)"
                    value={state.multiSource?.link_by || ""}
                    onChange={(e) =>
                      dispatch({
                        type: "SET_MULTI_SOURCE",
                        payload: {
                          ...(state.multiSource || { sources: [] }),
                          link_by: e.target.value || undefined,
                        },
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Column name used to match samples across different sources
                  </p>
                </div>

                {/* Shared Targets Toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm">Shared Targets</Label>
                    <p className="text-xs text-muted-foreground">
                      Same target file applies to all sources
                    </p>
                  </div>
                  <Switch
                    checked={state.multiSource?.shared_targets ?? true}
                    onCheckedChange={(checked) =>
                      dispatch({
                        type: "SET_MULTI_SOURCE",
                        payload: {
                          ...(state.multiSource || { sources: [] }),
                          shared_targets: checked,
                        },
                      })
                    }
                  />
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
    </div>
  );
}
