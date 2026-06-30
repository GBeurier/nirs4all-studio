import { useCallback, useState } from "react";
import { toast } from "sonner";
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
      toast.error("Failed to load pipeline samples");
    } finally {
      setSamplesLoading(false);
    }
  }, [samples.length]);

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
      toast.error(`Failed to load sample: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [importIntoEditor]);

  return {
    samples,
    samplesLoading,
    loadSamples,
    loadSample,
  };
}
