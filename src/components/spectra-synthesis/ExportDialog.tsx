/**
 * Export Dialog for Synthetic Dataset
 *
 * Provides options to export generated synthetic datasets to:
 * - Workspace (linked as a dataset)
 * - Custom folder path (CSV format)
 */

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Download,
  FolderOpen,
  Database,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useSynthesisBuilder } from "./contexts/SynthesisBuilderContext";

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface GenerateResponse {
  success: boolean;
  dataset_id?: string;
  dataset_name?: string;
  export_path?: string;
  shape: [number, number];
  execution_time_ms: number;
  linked_to_workspace: boolean;
  error?: string;
}

export function ExportDialog({ open, onOpenChange }: ExportDialogProps) {
  const { state } = useSynthesisBuilder();
  const [exportMode, setExportMode] = useState<"workspace" | "csv">("workspace");
  const [customPath, setCustomPath] = useState("");
  const [datasetName, setDatasetName] = useState("");

  // Check if workspace is available
  const { data: workspace } = useQuery({
    queryKey: ["workspace"],
    queryFn: async () => {
      const response = await fetch("/api/workspace");
      if (!response.ok) return null;
      const data = await response.json();
      return data.workspace;
    },
  });

  // Generate mutation
  const generateMutation = useMutation({
    mutationFn: async () => {
      const enabledSteps = state.steps.filter((s) => s.enabled);
      const config = {
        name: datasetName || state.name,
        n_samples: state.n_samples,
        random_state: state.random_state,
        steps: enabledSteps.map((s) => ({
          id: s.id,
          type: s.type,
          method: s.method,
          params: s.params,
          enabled: s.enabled,
        })),
      };

      const response = await fetch("/api/synthesis/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config,
          export_to_workspace: exportMode === "workspace",
          export_to_csv: exportMode === "csv" ? customPath : null,
          dataset_name: datasetName || undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Generation failed");
      }

      return response.json() as Promise<GenerateResponse>;
    },
    onSuccess: () => {
      // Could add a toast notification here
    },
  });

  const handleGenerate = () => {
    generateMutation.mutate();
  };

  const handleClose = () => {
    if (!generateMutation.isPending) {
      generateMutation.reset();
      onOpenChange(false);
    }
  };

  const hasNoSteps = state.steps.filter((s) => s.enabled).length === 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Export Synthetic Dataset
          </DialogTitle>
          <DialogDescription>
            Generate and export the dataset with {state.n_samples} samples
          </DialogDescription>
        </DialogHeader>

        {generateMutation.isSuccess ? (
          <div className="py-6 space-y-4">
            <div className="flex items-center justify-center text-green-600">
              <CheckCircle2 className="h-12 w-12" />
            </div>
            <div className="text-center space-y-2">
              <p className="font-medium">Dataset Generated Successfully</p>
              <p className="text-sm text-muted-foreground">
                Shape: {generateMutation.data.shape[0]} samples x{" "}
                {generateMutation.data.shape[1]} wavelengths
              </p>
              {generateMutation.data.export_path && (
                <p className="text-sm text-muted-foreground break-all">
                  Saved to: {generateMutation.data.export_path}
                </p>
              )}
              {generateMutation.data.linked_to_workspace && (
                <p className="text-sm text-green-600">
                  Linked to workspace
                </p>
              )}
            </div>
          </div>
        ) : generateMutation.isError ? (
          <div className="py-6 space-y-4">
            <div className="flex items-center justify-center text-destructive">
              <AlertCircle className="h-12 w-12" />
            </div>
            <div className="text-center space-y-2">
              <p className="font-medium text-destructive">Generation Failed</p>
              <p className="text-sm text-muted-foreground">
                {generateMutation.error instanceof Error
                  ? generateMutation.error.message
                  : "Unknown error"}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            {/* Dataset name */}
            <div className="space-y-2">
              <Label htmlFor="dataset-name">Dataset Name</Label>
              <Input
                id="dataset-name"
                placeholder={state.name || "synthetic_nirs"}
                value={datasetName}
                onChange={(e) => setDatasetName(e.target.value)}
              />
            </div>

            {/* Export mode selection */}
            <div className="space-y-3">
              <Label>Export Destination</Label>
              <RadioGroup
                value={exportMode}
                onValueChange={(v) => setExportMode(v as "workspace" | "csv")}
                className="space-y-2"
              >
                <div className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer">
                  <RadioGroupItem value="workspace" id="workspace" />
                  <Label
                    htmlFor="workspace"
                    className="flex items-center gap-2 cursor-pointer flex-1"
                  >
                    <Database className="h-4 w-4 text-teal-600" />
                    <div>
                      <div>Add to Workspace</div>
                      <div className="text-xs text-muted-foreground">
                        {workspace
                          ? `Export to ${workspace.name} and link automatically`
                          : "No workspace selected"}
                      </div>
                    </div>
                  </Label>
                </div>

                <div className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer">
                  <RadioGroupItem value="csv" id="csv" />
                  <Label
                    htmlFor="csv"
                    className="flex items-center gap-2 cursor-pointer flex-1"
                  >
                    <FolderOpen className="h-4 w-4 text-cyan-600" />
                    <div>
                      <div>Export to Folder</div>
                      <div className="text-xs text-muted-foreground">
                        Save as CSV files to a custom location
                      </div>
                    </div>
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* Custom path input */}
            {exportMode === "csv" && (
              <div className="space-y-2">
                <Label htmlFor="custom-path">Export Path</Label>
                <Input
                  id="custom-path"
                  placeholder="/path/to/export/folder"
                  value={customPath}
                  onChange={(e) => setCustomPath(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Dataset will be exported to this folder with Xcal.csv, Xval.csv,
                  ycal.csv, yval.csv
                </p>
              </div>
            )}

            {/* Warnings */}
            {hasNoSteps && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                No steps are enabled. Add at least a Features step for basic
                generation.
              </div>
            )}

            {exportMode === "workspace" && !workspace && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                No workspace is currently selected. Please select a workspace first
                or use "Export to Folder" option.
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {generateMutation.isSuccess || generateMutation.isError ? (
            <Button onClick={handleClose}>Close</Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleGenerate}
                disabled={
                  generateMutation.isPending ||
                  hasNoSteps ||
                  (exportMode === "workspace" && !workspace) ||
                  (exportMode === "csv" && !customPath)
                }
              >
                {generateMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    Generate & Export
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
