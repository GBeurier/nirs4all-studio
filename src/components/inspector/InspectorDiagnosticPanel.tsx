import type { ReactNode } from "react";

import { InlineError } from "@/components/ui/state-display";
import type { InspectorPanelRenderState } from "@/lib/inspector/panelRenderState";
import { InspectorPanel, type InspectorPanelProps } from "./InspectorPanel";
import { InspectorPanelNoticeView } from "./InspectorPanelNotice";

export interface InspectorDiagnosticPanelProps extends Omit<InspectorPanelProps, "children"> {
  children: ReactNode;
  renderState: InspectorPanelRenderState;
}

export function InspectorDiagnosticPanel({
  children,
  renderState,
  ...panelProps
}: InspectorDiagnosticPanelProps) {
  let content = children;
  if (renderState.kind === "notice") {
    content = <InspectorPanelNoticeView {...renderState.notice} />;
  } else if (renderState.kind === "error") {
    content = <InlineError message={renderState.message} />;
  }

  return (
    <InspectorPanel {...panelProps}>
      {content}
    </InspectorPanel>
  );
}
