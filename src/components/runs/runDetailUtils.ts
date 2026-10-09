import i18next from "i18next";
import type { ChainPipelineReloadMetadata, RunPipelineReloadMetadata } from "@/api/aggregatedPredictions";
import { buildCanonicalPreviewSteps } from "@/lib/canonicalPipelinePreview";
import { buildPipelinePreview } from "@/lib/pipelineStats";
import type { WorkspaceRunPipelineLogEntry } from "@/types/enriched-runs";
import { getActiveLocale } from "@/lib/activeLocale";

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
    return new Date(iso).toLocaleString(getActiveLocale(), { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function formatBoolean(value: unknown): string {
  if (value === true) return i18next.t("common.yes");
  if (value === false) return i18next.t("common.no");
  return "-";
}

export function formatCVStrategy(strategy?: unknown): string {
  if (typeof strategy !== "string" || !strategy) return "-";
  const known = [
    "kfold", "stratified", "stratified_kfold", "group_kfold", "stratified_group_kfold", "loo", "holdout",
    "repeated_kfold", "repeated_stratified_kfold", "shuffle_split", "stratified_shuffle_split",
    "group_shuffle_split", "time_series_split",
  ];
  const key = strategy.toLowerCase();
  return known.includes(key) ? i18next.t(`runs.detail.cvStrategies.${key}`) : strategy;
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
  if (!step || typeof step !== "object") return i18next.t("runs.detail.stepFallback");

  const record = step as Record<string, unknown>;
  if (record.model && typeof record.model === "object") {
    const model = record.model as Record<string, unknown>;
    const classReference = typeof model.class === "string" ? model.class : typeof record.name === "string" ? record.name : i18next.t("runs.detail.modelFallback");
    return classReference.split(".").pop() || classReference;
  }
  if (typeof record.class === "string") {
    return record.class.split(".").pop() || record.class;
  }
  if (record.branch) return i18next.t("runs.detail.branchFallback");
  if (record.merge) return i18next.t("runs.detail.mergeFallback");
  if (record.y_processing) return i18next.t("runs.detail.yProcessingFallback");
  return i18next.t("runs.detail.stepFallback");
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
    const previewSteps = buildCanonicalPreviewSteps(canonicalSteps);
    const preview = buildPipelinePreview(previewSteps, 256);
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

export function describeRunPipelineReload(
  reload: RunPipelineReloadMetadata | null | undefined,
  loadedStepCount: number,
): { title: string; description: string } {
  const stepCount = Math.max(0, Math.round(loadedStepCount));

  if (reload?.source === "authoring_template" && reload.is_editable_template && !reload.is_legacy_fallback) {
    return {
      title: i18next.t("runs.detail.reload.templateTitle"),
      description: i18next.t("runs.detail.reload.templateDescription", { count: stepCount }),
    };
  }

  return {
    title: i18next.t("runs.detail.reload.legacyTitle"),
    description: i18next.t("runs.detail.reload.legacyDescription", { count: stepCount }),
  };
}

export function describeChainPipelineReload(
  reload: ChainPipelineReloadMetadata | null | undefined,
  loadedStepCount: number,
): { title: string; description: string } {
  const stepCount = Math.max(0, Math.round(loadedStepCount));

  if (
    reload?.source === "chain_snapshot"
    && reload.selection_scope === "preprocessing_chain_plus_selected_model"
    && !reload.is_editable_template
  ) {
    return {
      title: i18next.t("runs.detail.reload.chainTitle"),
      description: i18next.t("runs.detail.reload.chainModelDescription", { count: stepCount }),
    };
  }

  return {
    title: i18next.t("runs.detail.reload.chainTitle"),
    description: i18next.t("runs.detail.reload.chainDescription", { count: stepCount }),
  };
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
  const createdAt = entry.created_at ? new Date(entry.created_at).toLocaleTimeString(getActiveLocale()) : "--:--:--";
  const level = (entry.level || "info").toUpperCase();
  const step = entry.step_idx != null ? i18next.t("runs.detail.logStep", { index: entry.step_idx }) : i18next.t("runs.detail.logPipeline");
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
