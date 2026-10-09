import type { TFunction } from "i18next";
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
  t: TFunction;
}

function oppositeTask(task: InspectorTaskPanelRequirement): InspectorTaskPanelRequirement {
  return task === "regression" ? "classification" : "regression";
}

export function getInspectorTaskPanelNotice({
  panelName,
  requiredTask,
  focus,
  t,
}: InspectorTaskPanelNoticeOptions): InspectorPanelNotice | null {
  if (focus.chainIds.length === 0) {
    return {
      title: t("inspector.notices.unavailable", { panel: panelName }),
      body: t("inspector.notices.emptyFocus"),
      tone: "default",
    };
  }

  const incompatibleTask = oppositeTask(requiredTask);
  if (focus.task === incompatibleTask) {
    return {
      title: t("inspector.notices.requires", { panel: panelName, task: t(`inspector.notices.tasks.${requiredTask}`) }),
      body: t("inspector.notices.requiresBody", {
        current: t(`inspector.notices.tasks.${incompatibleTask}`),
        required: t(`inspector.notices.tasks.${requiredTask}`),
      }),
      tone: "warning",
    };
  }

  if (focus.task === "mixed") {
    return {
      title: t("inspector.notices.needsCoherentFocus", { panel: panelName }),
      body: t("inspector.notices.mixedFocusBody"),
      tone: "warning",
    };
  }

  return null;
}

export function getInspectorTopologyPanelNotice(topologyPipelineId: string | null, t: TFunction): InspectorPanelNotice | null {
  if (topologyPipelineId) return null;
  return {
    title: t("inspector.notices.topologyTitle"),
    body: t("inspector.notices.topologyBody"),
    tone: "warning",
  };
}
