import { buildPipelinePreview } from "@/lib/pipelineStats";
import { importFromNirs4all } from "@/utils/pipelineConverter";
import type { WorkspaceRunPipelineLogEntry } from "@/types/enriched-runs";

const DROP_PIPELINE_STEP = Symbol("drop-pipeline-step");

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "-";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

export function formatDurationMs(durationMs: number | null | undefined): string {
  if (durationMs == null) return "-";
  return formatDuration(Math.max(0, Math.round(durationMs / 1000)));
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, unitIndex)).toFixed(unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`;
}

export function formatDatetime(iso: string | null | undefined): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function formatBoolean(value: unknown): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "-";
}

export function formatCVStrategy(strategy?: unknown): string {
  if (typeof strategy !== "string" || !strategy) return "-";
  const labelMap: Record<string, string> = {
    kfold: "K-Fold",
    stratified: "Stratified K-Fold",
    stratified_kfold: "Stratified K-Fold",
    group_kfold: "Group K-Fold",
    stratified_group_kfold: "Stratified Group K-Fold",
    loo: "Leave-One-Out",
    holdout: "Holdout",
    repeated_kfold: "Repeated K-Fold",
    repeated_stratified_kfold: "Repeated Stratified K-Fold",
    shuffle_split: "Shuffle Split",
    stratified_shuffle_split: "Stratified Shuffle Split",
    group_shuffle_split: "Group Shuffle Split",
    time_series_split: "Time Series Split",
  };
  return labelMap[strategy.toLowerCase()] || strategy;
}

export function extractExpandedPipelineSteps(expandedConfig: unknown): unknown[] {
  const rawSteps = Array.isArray(expandedConfig)
    ? expandedConfig
    : (
      expandedConfig
      && typeof expandedConfig === "object"
      && Array.isArray((expandedConfig as { pipeline?: unknown[] }).pipeline)
    )
      ? (expandedConfig as { pipeline: unknown[] }).pipeline
      : [];

  return rawSteps.flatMap((step) => {
    const cleaned = cleanExpandedPipelineStep(step);
    return cleaned === DROP_PIPELINE_STEP ? [] : [cleaned];
  });
}

function fallbackPipelineLabel(step: unknown): string {
  if (typeof step === "string") {
    if (step.includes("object at")) {
      const match = step.match(/([A-Za-z0-9_]+)\s+object at/i);
      return match?.[1] || step;
    }
    return step.split(".").pop() || step;
  }
  if (!step || typeof step !== "object") return "Step";

  const record = step as Record<string, unknown>;
  if (record.model && typeof record.model === "object") {
    const model = record.model as Record<string, unknown>;
    const classReference = typeof model.class === "string" ? model.class : typeof record.name === "string" ? record.name : "Model";
    return classReference.split(".").pop() || classReference;
  }
  if (typeof record.class === "string") {
    return record.class.split(".").pop() || record.class;
  }
  if (record.branch) return "Branch";
  if (record.merge) return "Merge";
  if (record.y_processing) return "Y Processing";
  return "Step";
}

export function buildStoredPipelinePreview(expandedConfig: unknown) {
  const canonicalSteps = extractExpandedPipelineSteps(expandedConfig);
  if (canonicalSteps.length === 0) {
    return {
      nodes: [] as Array<{ id: string; label: string; depth: number; kind: "step" | "branch" | "model"; hasGenerator: boolean }>,
      totalSteps: 0,
    };
  }

  try {
    const editorSteps = importFromNirs4all(canonicalSteps as Parameters<typeof importFromNirs4all>[0]);
    const preview = buildPipelinePreview(editorSteps, 256);
    return { nodes: preview.nodes, totalSteps: preview.totalSteps };
  } catch {
    return {
      nodes: canonicalSteps.map((step, index) => ({
        id: `raw-step-${index}`,
        label: fallbackPipelineLabel(step),
        depth: 0,
        kind: "step" as const,
        hasGenerator: false,
      })),
      totalSteps: canonicalSteps.length,
    };
  }
}

function isRuntimeOnlyStepRepr(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.includes(" object at 0x")
    && value.trim().startsWith("<")
    && value.trim().endsWith(">")
  );
}

function cleanExpandedPipelineStep(step: unknown): unknown | typeof DROP_PIPELINE_STEP {
  if (step == null) return step;

  if (Array.isArray(step)) {
    return step.flatMap((item) => {
      const cleaned = cleanExpandedPipelineStep(item);
      return cleaned === DROP_PIPELINE_STEP ? [] : [cleaned];
    });
  }

  if (typeof step === "string") {
    return isRuntimeOnlyStepRepr(step) ? DROP_PIPELINE_STEP : step;
  }

  if (typeof step !== "object") {
    return step;
  }

  const record = step as Record<string, unknown>;
  if (isRuntimeOnlyStepRepr(record.class) || isRuntimeOnlyStepRepr(record.function)) {
    return DROP_PIPELINE_STEP;
  }
  if (typeof record.model === "string" && isRuntimeOnlyStepRepr(record.model)) {
    return DROP_PIPELINE_STEP;
  }

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const next = cleanExpandedPipelineStep(value);
    if (next === DROP_PIPELINE_STEP) continue;
    cleaned[key] = next;
  }
  return cleaned;
}

export function formatLogLine(entry: WorkspaceRunPipelineLogEntry): string {
  const createdAt = entry.created_at ? new Date(entry.created_at).toLocaleTimeString() : "--:--:--";
  const level = (entry.level || "info").toUpperCase();
  const step = entry.step_idx != null ? `step ${entry.step_idx}` : "pipeline";
  const operator = entry.operator_class ? ` ${entry.operator_class}` : "";
  const event = entry.event ? ` [${entry.event}]` : "";
  const message = entry.message || "";
  const details =
    entry.details && typeof entry.details === "object"
      ? ` ${JSON.stringify(entry.details)}`
      : entry.details && typeof entry.details === "string"
      ? ` ${entry.details}`
      : "";
  return `${createdAt} [${level}] ${step}${operator}${event} ${message}${details}`.trim();
}

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
