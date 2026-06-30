import type { InspectorFocusState, InspectorFocusTask } from "@/lib/inspector/focus";

export type InspectorPanelNoticeTone = "default" | "warning";
export type InspectorTaskPanelRequirement = Extract<InspectorFocusTask, "classification" | "regression">;

export interface InspectorPanelNotice {
  title: string;
  body: string;
  tone: InspectorPanelNoticeTone;
}

export interface InspectorTaskPanelNoticeOptions {
  panelName: string;
  requiredTask: InspectorTaskPanelRequirement;
  focus: Pick<InspectorFocusState, "chainIds" | "task">;
}

const MIXED_FOCUS_BODY = "Selected chains mix regression and classification. Narrow the shared selection or rely on auto focus.";
const EMPTY_FOCUS_BODY = "No chains are available in the current scope.";

function oppositeTask(task: InspectorTaskPanelRequirement): InspectorTaskPanelRequirement {
  return task === "regression" ? "classification" : "regression";
}

export function getInspectorTaskPanelNotice({
  panelName,
  requiredTask,
  focus,
}: InspectorTaskPanelNoticeOptions): InspectorPanelNotice | null {
  if (focus.chainIds.length === 0) {
    return {
      title: `${panelName} unavailable`,
      body: EMPTY_FOCUS_BODY,
      tone: "default",
    };
  }

  const incompatibleTask = oppositeTask(requiredTask);
  if (focus.task === incompatibleTask) {
    return {
      title: `${panelName} requires ${requiredTask}`,
      body: `Current focus is ${incompatibleTask}. Select or pin ${requiredTask} chains to populate this panel.`,
      tone: "warning",
    };
  }

  if (focus.task === "mixed") {
    return {
      title: `${panelName} needs a coherent focus`,
      body: MIXED_FOCUS_BODY,
      tone: "warning",
    };
  }

  return null;
}

export function getInspectorTopologyPanelNotice(topologyPipelineId: string | null): InspectorPanelNotice | null {
  if (topologyPipelineId) return null;
  return {
    title: "Topology needs one pipeline",
    body: "Select or pin chains from a single pipeline to inspect topology.",
    tone: "warning",
  };
}
