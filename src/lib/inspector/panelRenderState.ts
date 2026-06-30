import type { InspectorPanelNotice } from "@/lib/inspector/panelNotices";

export type InspectorPanelRenderState =
  | { kind: "notice"; notice: InspectorPanelNotice }
  | { kind: "error"; message: string }
  | { kind: "ready" };

export interface InspectorPanelRenderStateInput {
  notice: InspectorPanelNotice | null;
  error: unknown;
  errorFallback: string;
}

export function getInspectorQueryErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "detail" in error) {
    const detail = (error as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) return detail;
  }
  return fallback;
}

export function getInspectorPanelRenderState({
  notice,
  error,
  errorFallback,
}: InspectorPanelRenderStateInput): InspectorPanelRenderState {
  if (notice) return { kind: "notice", notice };
  if (error) return { kind: "error", message: getInspectorQueryErrorMessage(error, errorFallback) };
  return { kind: "ready" };
}
