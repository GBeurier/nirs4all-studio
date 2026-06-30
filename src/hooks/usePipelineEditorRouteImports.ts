import { useCallback, useEffect } from "react";
import type { NavigateFunction } from "react-router-dom";
import { toast } from "sonner";
import { getPipeline, previewPipelineImport } from "@/api/pipelines";
import {
  getChainPipelineSteps,
  getRunPipelineSteps,
} from "@/api/aggregatedPredictions";
import {
  clientStorageKeys,
  readClientStorageString,
  removeClientStorageItem,
} from "@/lib/clientStorage";
import { describeChainPipelineReload, describeRunPipelineReload } from "@/components/runs/runDetailUtils";
import {
  buildPipelinePayloadImportDraft,
  buildPlaygroundPipelineImportDraft,
  type PipelineEditorImportDraft,
} from "@/lib/pipelineEditorImport";
import type { PipelineStep } from "@/components/pipeline-editor/types";

type LoadPipeline = (steps: PipelineStep[], name?: string) => void;

interface UsePipelineEditorRouteImportsOptions {
  searchParams: URLSearchParams;
  pipelineId: string;
  isNew: boolean;
  hasPersistedDraft: boolean;
  navigate: NavigateFunction;
  loadPipeline: LoadPipeline;
  setIsFavorite: (isFavorite: boolean) => void;
}

export function usePipelineEditorRouteImports({
  searchParams,
  pipelineId,
  isNew,
  hasPersistedDraft,
  navigate,
  loadPipeline,
  setIsFavorite,
}: UsePipelineEditorRouteImportsOptions) {
  const importIntoEditor = useCallback(
    async ({ request, fallbackName }: PipelineEditorImportDraft) => {
      const result = await previewPipelineImport(request);
      const importedName = result.name || fallbackName || "Imported Pipeline";
      loadPipeline(result.steps as PipelineStep[], importedName);
      return {
        ...result,
        name: importedName,
      };
    },
    [loadPipeline],
  );

  useEffect(() => {
    if (isNew || hasPersistedDraft) return;

    let cancelled = false;

    (async () => {
      try {
        const pipeline = await getPipeline(pipelineId);
        if (cancelled) return;

        loadPipeline(pipeline.steps as PipelineStep[], pipeline.name);
        setIsFavorite(!!pipeline.is_favorite);
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to load pipeline:", error);
        toast.error(
          `Failed to load pipeline: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasPersistedDraft, isNew, loadPipeline, pipelineId, setIsFavorite]);

  useEffect(() => {
    const source = searchParams.get("source");
    if (source !== "playground") return;

    (async () => {
      try {
        const exportData = readClientStorageString(clientStorageKeys.playgroundPipelineExport);
        const draft = buildPlaygroundPipelineImportDraft(exportData);
        if (draft) {
          const imported = await importIntoEditor(draft);

          toast.success("Pipeline imported from Playground", {
            description: `${imported.steps.length} steps loaded`,
          });

          removeClientStorageItem(clientStorageKeys.playgroundPipelineExport);
        }
      } catch (e) {
        console.error("Failed to import from Playground:", e);
        toast.error("Failed to import pipeline from Playground");
      }

      navigate(`/pipelines/${pipelineId}`, { replace: true });
    })();
  }, [searchParams, importIntoEditor, navigate, pipelineId]);

  useEffect(() => {
    const chainId = searchParams.get("chainId");
    if (!chainId) return;

    (async () => {
      try {
        const result = await getChainPipelineSteps(chainId);
        const draft = buildPipelinePayloadImportDraft({
          name: result.name,
          pipeline: result.pipeline,
          fallbackName: result.name || "Chain Snapshot",
        });
        if (draft) {
          const imported = await importIntoEditor(draft);
          const toastCopy = describeChainPipelineReload(result.reload, imported.steps.length);

          toast.success(toastCopy.title, {
            description: toastCopy.description,
          });
        }
      } catch (e) {
        console.error("Failed to load chain snapshot:", e);
        toast.error("Failed to load chain snapshot");
      }

      navigate(`/pipelines/${pipelineId}`, { replace: true });
    })();
  }, [searchParams, importIntoEditor, navigate, pipelineId]);

  useEffect(() => {
    const runPipelineId = searchParams.get("runPipelineId");
    if (!runPipelineId) return;

    (async () => {
      try {
        const result = await getRunPipelineSteps(runPipelineId);
        const draft = buildPipelinePayloadImportDraft({
          name: result.name,
          pipeline: result.pipeline,
          fallbackName: result.name || "Run Pipeline",
        });
        if (draft) {
          const imported = await importIntoEditor(draft);
          const toastCopy = describeRunPipelineReload(result.reload, imported.steps.length);

          toast.success(toastCopy.title, {
            description: toastCopy.description,
          });
        }
      } catch (e) {
        console.error("Failed to load run pipeline:", e);
        toast.error("Failed to load pipeline from run");
      }

      navigate(`/pipelines/${pipelineId}`, { replace: true });
    })();
  }, [searchParams, importIntoEditor, navigate, pipelineId]);

  return { importIntoEditor };
}
