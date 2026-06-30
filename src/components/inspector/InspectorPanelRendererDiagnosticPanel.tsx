import type { ReactNode } from "react";

import type { InspectorFocusState } from "@/lib/inspector/focus";
import { InspectorDiagnosticPanel } from "./InspectorDiagnosticPanel";
import type { InspectorPanelProps } from "./InspectorPanel";
import {
  getInspectorPanelDiagnosticRenderState,
  type InspectorPanelRendererConfig,
} from "./inspectorPanelRegistry";

export interface InspectorPanelRendererDiagnosticPanelProps
  extends Omit<InspectorPanelProps, "children" | "isLoading"> {
  children: ReactNode;
  config: InspectorPanelRendererConfig;
  error: unknown;
  focus: Pick<InspectorFocusState, "chainIds" | "task" | "topologyPipelineId">;
  isLoading: boolean;
}

export function InspectorPanelRendererDiagnosticPanel({
  children,
  config,
  error,
  focus,
  isLoading,
  ...panelProps
}: InspectorPanelRendererDiagnosticPanelProps) {
  const renderState = getInspectorPanelDiagnosticRenderState({
    config,
    focus,
    error,
  });

  return (
    <InspectorDiagnosticPanel
      {...panelProps}
      isLoading={isLoading}
      renderState={renderState}
    >
      {children}
    </InspectorDiagnosticPanel>
  );
}
