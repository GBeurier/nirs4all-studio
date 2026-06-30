import { useCallback, useRef } from "react";
import type { ChangeEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { NavigateFunction } from "react-router-dom";
import { toast } from "sonner";
import { renderCanonicalPipeline, savePipeline } from "@/api/pipelines";
import {
  clearPersistedState,
  migrateDraftKey,
  type PipelineConfig,
} from "@/hooks/usePipelineEditor";
import {
  buildCurrentEditedPipelineHandoff,
  getExperimentRouteForPipeline,
  storeCurrentEditedPipelineHandoffInClientStorage,
} from "@/lib/pipelineExperimentHandoff";
import {
  buildPipelineFileImportDraft,
  type PipelineEditorImportDraft,
} from "@/lib/pipelineEditorImport";
import {
  buildCanonicalPipelineExport,
  buildEditorPipelineExport,
  downloadPipelineTextExport,
  type CanonicalPipelineExportFormat,
} from "@/lib/pipelineEditorExport";
import type { PipelineStep } from "@/components/pipeline-editor/types";

interface ExportedPipeline {
  name: string;
  steps: PipelineStep[];
  config: PipelineConfig;
}

type ExportPipeline = () => ExportedPipeline;
type ImportIntoEditor = (draft: PipelineEditorImportDraft) => Promise<{ name: string }>;

interface UsePipelineEditorRouteActionsOptions {
  pipelineId: string;
  isNew: boolean;
  isDirty: boolean;
  pipelineName: string;
  isFavorite: boolean;
  steps: PipelineStep[];
  navigate: NavigateFunction;
  setIsFavorite: (isFavorite: boolean) => void;
  clearPipeline: () => void;
  exportPipeline: ExportPipeline;
  importIntoEditor: ImportIntoEditor;
  closeClearDialog: () => void;
}

export function usePipelineEditorRouteActions({
  pipelineId,
  isNew,
  isDirty,
  pipelineName,
  isFavorite,
  steps,
  navigate,
  setIsFavorite,
  clearPipeline,
  exportPipeline,
  importIntoEditor,
  closeClearDialog,
}: UsePipelineEditorRouteActionsOptions) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const savePipelineMutation = useMutation({
    mutationFn: async () => {
      const pipelineData = exportPipeline();
      return savePipeline({
        id: isNew ? undefined : pipelineId,
        name: pipelineName,
        description: "",
        steps: pipelineData.steps,
        is_favorite: isFavorite,
      });
    },
    onSuccess: (result) => {
      toast.success(`"${pipelineName}" saved`);
      queryClient.invalidateQueries({ queryKey: ["pipelines"] });
      if (isNew && result?.pipeline?.id) {
        clearPersistedState(pipelineId);
        navigate(`/pipelines/${result.pipeline.id}`, { replace: true });
      }
    },
    onError: (error) => {
      toast.error(`Failed to save: ${error instanceof Error ? error.message : "Unknown error"}`);
    },
  });

  const handleSave = useCallback(() => {
    savePipelineMutation.mutate();
  }, [savePipelineMutation]);

  const handleNewPipeline = useCallback(() => {
    if (isNew && isDirty) {
      const stashId = `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      migrateDraftKey(pipelineId, stashId);
      toast.success("Current draft stashed", {
        description: "Find it under Drafts on the Pipelines page.",
      });
    }
    navigate("/pipelines/new");
  }, [isDirty, isNew, navigate, pipelineId]);

  const handleToggleFavorite = useCallback(() => {
    setIsFavorite(!isFavorite);
    toast.success(
      isFavorite
        ? `"${pipelineName}" removed from favorites`
        : `"${pipelineName}" added to favorites`,
    );
  }, [isFavorite, pipelineName, setIsFavorite]);

  const handleExportJson = useCallback(() => {
    const pipeline = exportPipeline();
    downloadPipelineTextExport(buildEditorPipelineExport(pipelineName, pipeline));
    toast.success("Pipeline exported as JSON");
  }, [exportPipeline, pipelineName]);

  const handleExportCanonical = useCallback(
    async (format: CanonicalPipelineExportFormat) => {
      try {
        const rendered = await renderCanonicalPipeline({
          steps,
          name: pipelineName,
        });
        downloadPipelineTextExport(
          buildCanonicalPipelineExport({
            pipelineName,
            rendered,
            format,
          }),
        );
        toast.success(`Pipeline exported as canonical ${format.toUpperCase()}`);
      } catch (error) {
        console.error("Canonical export error:", error);
        toast.error(
          `Failed to export canonical ${format.toUpperCase()}: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
      }
    },
    [pipelineName, steps],
  );

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileImport = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string;
        const imported = await importIntoEditor(buildPipelineFileImportDraft(file.name, content));
        toast.success(`Pipeline "${imported.name}" imported successfully`);
      } catch (err) {
        console.error("Import error:", err);
        toast.error(
          `Failed to import: ${err instanceof Error ? err.message : "Invalid file"}`,
        );
      }
    };
    reader.readAsText(file);

    event.target.value = "";
  }, [importIntoEditor]);

  const handleClearPipeline = useCallback(() => {
    clearPipeline();
    closeClearDialog();
    toast.success("Pipeline cleared");
  }, [clearPipeline, closeClearDialog]);

  const handleUseInExperiment = useCallback(() => {
    const pipelineData = exportPipeline();
    const route = getExperimentRouteForPipeline({
      pipelineId,
      isNew,
      isDirty,
    });

    if (isNew || isDirty) {
      storeCurrentEditedPipelineHandoffInClientStorage(
        buildCurrentEditedPipelineHandoff({
          pipelineId,
          isNew,
          name: pipelineName,
          steps: pipelineData.steps,
          isDirty,
        }),
      );
    }

    navigate(route);
  }, [exportPipeline, isDirty, isNew, navigate, pipelineId, pipelineName]);

  return {
    fileInputRef,
    handleSave,
    handleNewPipeline,
    handleToggleFavorite,
    handleExportJson,
    handleExportCanonical,
    handleImportClick,
    handleFileImport,
    handleClearPipeline,
    handleUseInExperiment,
  };
}
