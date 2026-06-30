import type { CanonicalPipelineRenderResponse } from "@/api/pipelines";

export type CanonicalPipelineExportFormat = "json" | "yaml";

export interface PipelineTextExport {
  filename: string;
  content: string;
  mimeType: string;
}

export function buildEditorPipelineExport(
  pipelineName: string,
  pipeline: unknown,
): PipelineTextExport {
  return {
    filename: `${getPipelineExportFileStem(pipelineName)}.json`,
    content: JSON.stringify(pipeline, null, 2),
    mimeType: "application/json",
  };
}

export function buildCanonicalPipelineExport({
  pipelineName,
  rendered,
  format,
}: {
  pipelineName: string;
  rendered: CanonicalPipelineRenderResponse;
  format: CanonicalPipelineExportFormat;
}): PipelineTextExport {
  return {
    filename: `${getPipelineExportFileStem(pipelineName)}_nirs4all.${format}`,
    content: format === "yaml" ? rendered.yaml : rendered.json,
    mimeType: format === "yaml" ? "text/yaml" : "application/json",
  };
}

export function getPipelineExportFileStem(pipelineName: string): string {
  return pipelineName.trim().replace(/\s+/g, "_") || "pipeline";
}

export function downloadPipelineTextExport({
  filename,
  content,
  mimeType,
}: PipelineTextExport): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
