import type { PipelineImportRequest } from "@/api/pipelines";
import { PLAYGROUND_EXPORT_KEY } from "./playground/operatorFormat";

export { PLAYGROUND_EXPORT_KEY };

export interface PipelineEditorImportDraft {
  request: PipelineImportRequest;
  fallbackName: string;
}

export interface PipelinePayloadImportInput {
  name?: string | null;
  pipeline?: unknown;
  fallbackName: string;
}

export function buildPlaygroundPipelineImportDraft(
  rawExportData: string | null,
): PipelineEditorImportDraft | null {
  const exportData = parsePlaygroundExportData(rawExportData);
  if (!exportData) return null;

  const fallbackName = exportData.name || "Imported from Playground";

  return {
    request: {
      payload: {
        name: fallbackName,
        pipeline: exportData.steps.map(playgroundStepToCanonicalStep),
      },
    },
    fallbackName,
  };
}

export function buildPipelinePayloadImportDraft({
  name,
  pipeline,
  fallbackName,
}: PipelinePayloadImportInput): PipelineEditorImportDraft | null {
  if (!Array.isArray(pipeline)) return null;

  return {
    request: {
      payload: {
        name,
        pipeline,
      },
    },
    fallbackName: name || fallbackName,
  };
}

export function buildPipelineFileImportDraft(fileName: string, content: string): PipelineEditorImportDraft {
  return {
    request: {
      content,
      format: getPipelineImportFormat(fileName),
    },
    fallbackName: getPipelineImportFallbackName(fileName),
  };
}

export function getPipelineImportFormat(fileName: string): "json" | "yaml" {
  return fileName.endsWith(".yaml") || fileName.endsWith(".yml")
    ? "yaml"
    : "json";
}

export function getPipelineImportFallbackName(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, "") || "Imported Pipeline";
}

interface PlaygroundPipelineExportData {
  name?: string;
  steps: PlaygroundPipelineExportStep[];
}

interface PlaygroundPipelineExportStep {
  type: string;
  name: string;
  params?: Record<string, unknown>;
}

function parsePlaygroundExportData(rawExportData: string | null): PlaygroundPipelineExportData | null {
  if (!rawExportData) return null;

  try {
    const parsed = JSON.parse(rawExportData) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.steps)) return null;

    const steps = parsed.steps.map(toPlaygroundPipelineExportStep);
    if (steps.some((step) => step == null)) return null;

    return {
      name: typeof parsed.name === "string" ? parsed.name : undefined,
      steps: steps as PlaygroundPipelineExportStep[],
    };
  } catch {
    return null;
  }
}

function toPlaygroundPipelineExportStep(value: unknown): PlaygroundPipelineExportStep | null {
  if (!isRecord(value)) return null;
  if (typeof value.type !== "string" || typeof value.name !== "string") return null;

  return {
    type: value.type,
    name: value.name,
    params: isRecord(value.params) ? value.params : {},
  };
}

function playgroundStepToCanonicalStep(step: PlaygroundPipelineExportStep): Record<string, unknown> {
  return {
    [getCanonicalKeyForPlaygroundStep(step.type)]: step.name,
    ...step.params,
  };
}

function getCanonicalKeyForPlaygroundStep(stepType: string): "split" | "model" | "preprocessing" {
  if (stepType === "splitting") return "split";
  if (stepType === "model") return "model";
  return "preprocessing";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
