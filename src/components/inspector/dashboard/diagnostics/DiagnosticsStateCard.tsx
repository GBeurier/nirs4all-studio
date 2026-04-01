import type { ReactNode } from "react";
import { AlertTriangle, Info, Layers3, OctagonAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type DiagnosticsStateTone = "neutral" | "warning" | "danger" | "info";

export interface DiagnosticsStateCardProps {
  title: string;
  description: string;
  reason?: string;
  tone?: DiagnosticsStateTone;
  icon?: ReactNode;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  className?: string;
}

function defaultIcon(tone: DiagnosticsStateTone) {
  switch (tone) {
    case "warning":
      return <AlertTriangle className="h-4 w-4" />;
    case "danger":
      return <OctagonAlert className="h-4 w-4" />;
    case "info":
      return <Info className="h-4 w-4" />;
    default:
      return <Layers3 className="h-4 w-4" />;
  }
}

export function DiagnosticsStateCard({
  title,
  description,
  reason,
  tone = "neutral",
  icon,
  action,
  secondaryAction,
  className,
}: DiagnosticsStateCardProps) {
  return (
    <Card className={cn("border-dashed border-border/70 bg-muted/20 shadow-none", className)}>
      <CardHeader className="space-y-2 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border/70 bg-background">
            {icon ?? defaultIcon(tone)}
          </div>
          <div className="space-y-1">
            <CardTitle className="text-sm">{title}</CardTitle>
            <CardDescription className="text-xs">{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {reason ? (
          <div
            className={cn(
              "rounded-lg border px-3 py-2 text-xs leading-5",
              tone === "danger" && "border-destructive/30 bg-destructive/10 text-destructive-foreground",
              tone === "warning" && "border-amber-500/30 bg-amber-500/10 text-foreground",
              tone === "info" && "border-sky-500/30 bg-sky-500/10 text-foreground",
              tone === "neutral" && "border-border/60 bg-background/70 text-muted-foreground",
            )}
          >
            {reason}
          </div>
        ) : null}

        {(action || secondaryAction) && (
          <div className="flex flex-wrap gap-2">
            {action}
            {secondaryAction}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export interface DiagnosticsEmptyStateProps {
  title: string;
  description: string;
  reason?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  className?: string;
}

export function DiagnosticsEmptyState({
  title,
  description,
  reason,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  className,
}: DiagnosticsEmptyStateProps) {
  return (
    <DiagnosticsStateCard
      title={title}
      description={description}
      reason={reason}
      tone="info"
      className={className}
      action={
        actionLabel && onAction ? (
          <Button type="button" size="sm" onClick={onAction}>
            {actionLabel}
          </Button>
        ) : undefined
      }
      secondaryAction={
        secondaryActionLabel && onSecondaryAction ? (
          <Button type="button" variant="outline" size="sm" onClick={onSecondaryAction}>
            {secondaryActionLabel}
          </Button>
        ) : undefined
      }
    />
  );
}

export interface DiagnosticsUnsupportedStateProps {
  title: string;
  description: string;
  reason: string;
  className?: string;
}

export function DiagnosticsUnsupportedState({
  title,
  description,
  reason,
  className,
}: DiagnosticsUnsupportedStateProps) {
  return (
    <DiagnosticsStateCard
      title={title}
      description={description}
      reason={reason}
      tone="warning"
      className={className}
    />
  );
}
