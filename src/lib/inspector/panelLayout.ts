import { PANEL_MAP } from "@/lib/inspector/chartRegistry";
import type { InspectorPanelType, InspectorViewState } from "@/types/inspector";

export type InspectorPanelLayoutMode = "auto" | "grid-2" | "grid-3" | "single-column";

export interface InspectorPanelRenderOrderInput {
  panelStates: Readonly<Partial<Record<InspectorPanelType, InspectorViewState>>>;
  hasMaximized: boolean;
  maximizedPanel: InspectorPanelType | null;
}

export interface InspectorPanelGridClassInput {
  hasMaximized: boolean;
  layoutMode: InspectorPanelLayoutMode;
}

export function getInspectorPanelIdsToRender({
  panelStates,
  hasMaximized,
  maximizedPanel,
}: InspectorPanelRenderOrderInput): InspectorPanelType[] {
  if (hasMaximized && maximizedPanel) return [maximizedPanel];

  const visible = Object.entries(panelStates)
    .filter(([, state]) => state !== "hidden")
    .map(([panel]) => panel as InspectorPanelType);

  return visible.sort((left, right) => {
    const leftPriority = PANEL_MAP.get(left)?.priority ?? 0;
    const rightPriority = PANEL_MAP.get(right)?.priority ?? 0;
    return leftPriority - rightPriority;
  });
}

export function getInspectorPanelGridClassName({
  hasMaximized,
  layoutMode,
}: InspectorPanelGridClassInput): string {
  if (hasMaximized) return "grid grid-cols-1";
  if (layoutMode === "single-column") return "grid grid-cols-1 gap-4";
  if (layoutMode === "grid-2") return "grid grid-cols-1 gap-4 xl:grid-cols-2";
  if (layoutMode === "grid-3") return "grid grid-cols-1 gap-4 xl:grid-cols-3";
  return "grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3";
}
