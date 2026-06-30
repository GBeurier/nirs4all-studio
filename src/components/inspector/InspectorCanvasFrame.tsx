import type { ReactNode } from "react";

import { InspectorToolbar } from "./InspectorToolbar";

export interface InspectorCanvasFrameProps {
  children: ReactNode;
  contentClassName?: string;
  scrollable?: boolean;
}

export function InspectorCanvasFrame({
  children,
  contentClassName = "p-4",
  scrollable = false,
}: InspectorCanvasFrameProps) {
  const content = (
    <div className={contentClassName}>
      {children}
    </div>
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-background">
      <InspectorToolbar />
      {scrollable ? (
        <div className="flex-1 overflow-auto">
          {content}
        </div>
      ) : content}
    </div>
  );
}
