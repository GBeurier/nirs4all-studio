import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useApiErrorToast } from "@/hooks/useApiErrorToast";
import { getPipelineSample, listPipelineSamples } from "@/api/pipelines";
import type { PipelineSampleInfo } from "@/api/pipelines";
import {
  buildPipelinePayloadImportDraft,
  type PipelineEditorImportDraft,
} from "@/lib/pipelineEditorImport";

type ImportIntoEditor = (draft: PipelineEditorImportDraft) => Promise<{ name: string }>;

interface UsePipelineEditorSamplesOptions {
  importIntoEditor: ImportIntoEditor;
}

export function usePipelineEditorSamples({
  importIntoEditor,
}: UsePipelineEditorSamplesOptions) {
  const { t } = useTranslation();
  const notifyApiError = useApiErrorToast();
  const [samples, setSamples] = useState<PipelineSampleInfo[]>([]);
  const [samplesLoading, setSamplesLoading] = useState(false);

  const loadSamples = useCallback(async () => {
    if (samples.length > 0) return;
    setSamplesLoading(true);
    try {
      const result = await listPipelineSamples();
      setSamples(result.samples);
    } catch (err) {
      console.error("Failed to load samples:", err);
      notifyApiError(err, t("errors.action.loadSamples"));
    } finally {
      setSamplesLoading(false);
    }
  }, [samples.length, t, notifyApiError]);

  const loadSample = useCallback(async (sampleId: string, sampleName: string) => {
    try {
      const result = await getPipelineSample(sampleId, true);
      const draft = buildPipelinePayloadImportDraft({
        name: result.name,
        pipeline: result.pipeline,
        fallbackName: result.name || sampleName,
      });
      if (!draft) throw new Error("Sample does not contain a pipeline");
      const imported = await importIntoEditor(draft);
      toast.success(`Loaded sample: ${imported.name}`);
    } catch (err) {
      console.error("Failed to load sample:", err);
      notifyApiError(err, t("errors.action.loadSample"));
    }
  }, [importIntoEditor, t, notifyApiError]);

  return {
    samples,
    samplesLoading,
    loadSamples,
    loadSample,
  };
}
