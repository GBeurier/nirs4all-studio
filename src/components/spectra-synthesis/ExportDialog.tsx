/**
 * Export Dialog for Synthetic Dataset
 *
 * Provides options to export generated synthetic datasets to:
 * - Workspace (linked as a dataset)
 * - Custom folder path (CSV format)
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { api } from "@/api/transport";
import { getWorkspace } from "@/api/workspace";
import { useSynthesisBuilder } from "./contexts";

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
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { state } = useSynthesisBuilder();
  const [exportMode, setExportMode] = useState<"workspace" | "csv">("workspace");
  const [customPath, setCustomPath] = useState("");
  const [datasetName, setDatasetName] = useState("");

  // Check if workspace is available
  const { data: workspace } = useQuery({
    queryKey: ["workspace"],
    queryFn: async () => {
      try {
        const data = await getWorkspace();
        return data.workspace;
      } catch {
        return null;
      }
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

      try {
        return await api.post<GenerateResponse>("/synthesis/generate", {
          config,
          export_to_workspace: exportMode === "workspace",
          export_to_csv: exportMode === "csv" ? customPath : null,
          dataset_name: datasetName || undefined,
        });
      } catch (error) {
        const detail = error && typeof error === "object" && "detail" in error
          ? (error as { detail?: unknown }).detail
          : null;
        throw new Error(
          typeof detail === "string" && detail ? detail : t("spectraSynthesis.export.failedTitle"),
        );
      }
    },
    onSuccess: async (result) => {
      if (result.linked_to_workspace) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["datasets"] }),
          queryClient.invalidateQueries({ queryKey: ["workspace"] }),
        ]);
      }
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
            {t("spectraSynthesis.export.title")}
          </DialogTitle>
          <DialogDescription>
            {t("spectraSynthesis.export.description", { count: state.n_samples })}
          </DialogDescription>
        </DialogHeader>

        {generateMutation.isSuccess ? (
          <div className="py-6 space-y-4">
            <div className="flex items-center justify-center text-green-600">
              <CheckCircle2 className="h-12 w-12" />
            </div>
            <div className="text-center space-y-2">
              <p className="font-medium">{t("spectraSynthesis.export.successTitle")}</p>
              <p className="text-sm text-muted-foreground">
                {t("spectraSynthesis.export.shape", {
                  samples: generateMutation.data.shape[0],
                  wavelengths: generateMutation.data.shape[1],
                })}
              </p>
              {generateMutation.data.export_path && (
                <p className="text-sm text-muted-foreground break-all">
                  {t("spectraSynthesis.export.savedTo", { path: generateMutation.data.export_path })}
                </p>
              )}
              {generateMutation.data.linked_to_workspace && (
                <p className="text-sm text-green-600">
                  {t("spectraSynthesis.export.linkedToWorkspace")}
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
              <p className="font-medium text-destructive">{t("spectraSynthesis.export.failedTitle")}</p>
              <p className="text-sm text-muted-foreground">
                {generateMutation.error instanceof Error
                  ? generateMutation.error.message
                  : t("spectraSynthesis.export.unknownError")}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            {/* Dataset name */}
            <div className="space-y-2">
              <Label htmlFor="dataset-name">{t("spectraSynthesis.export.datasetName")}</Label>
              <Input
                id="dataset-name"
                placeholder={state.name || "synthetic_nirs"}
                value={datasetName}
                onChange={(e) => setDatasetName(e.target.value)}
              />
            </div>

            {/* Export mode selection */}
            <div className="space-y-3">
              <Label>{t("spectraSynthesis.export.destination")}</Label>
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
                      <div>{t("spectraSynthesis.export.toWorkspace")}</div>
                      <div className="text-xs text-muted-foreground">
                        {workspace
                          ? t("spectraSynthesis.export.workspaceDescription", { name: workspace.name })
                          : t("spectraSynthesis.export.noWorkspaceSelected")}
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
                      <div>{t("spectraSynthesis.export.toFolder")}</div>
                      <div className="text-xs text-muted-foreground">
                        {t("spectraSynthesis.export.folderDescription")}
                      </div>
                    </div>
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* Custom path input */}
            {exportMode === "csv" && (
              <div className="space-y-2">
                <Label htmlFor="custom-path">{t("spectraSynthesis.export.path")}</Label>
                <Input
                  id="custom-path"
                  placeholder="/path/to/export/folder"
                  value={customPath}
                  onChange={(e) => setCustomPath(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t("spectraSynthesis.export.pathHint")}
                </p>
              </div>
            )}

            {/* Warnings */}
            {hasNoSteps && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                {t("spectraSynthesis.export.warningNoSteps")}
              </div>
            )}

            {exportMode === "workspace" && !workspace && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                {t("spectraSynthesis.export.warningNoWorkspace")}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {generateMutation.isSuccess || generateMutation.isError ? (
            <Button onClick={handleClose}>{t("common.close")}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose}>
                {t("common.cancel")}
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
                    {t("spectraSynthesis.export.generating")}
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    {t("spectraSynthesis.export.generate")}
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
