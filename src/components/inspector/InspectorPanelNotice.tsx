import { cn } from "@/lib/utils";
import type { InspectorPanelNotice } from "@/lib/inspector/panelNotices";

export function InspectorPanelNoticeView({
  title,
  body,
  tone = "default",
}: InspectorPanelNotice) {
  return (
    <div
      className={cn(
        "flex h-full items-center justify-center rounded-lg border px-4 py-6 text-center",
        tone === "warning"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100"
          : "border-border/60 bg-muted/20 text-muted-foreground",
      )}
    >
      <div className="max-w-sm space-y-1">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className={cn("text-xs leading-5", tone === "warning" ? "text-amber-900 dark:text-amber-100" : "text-muted-foreground")}>
          {body}
        </div>
      </div>
    </div>
  );
}
