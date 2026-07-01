/**
 * Pure runtime/result status display helpers.
 *
 * This module owns the reusable view-model tokens for run and pipeline result
 * status rendering. React components map `icon` onto host-specific icon
 * components; the foundation stays framework-free.
 */

export const RUNTIME_RESULT_STATUSES = ["queued", "running", "completed", "failed", "partial"] as const;

export type RuntimeResultStatus = typeof RUNTIME_RESULT_STATUSES[number];

export type RuntimeResultStatusIcon = "clock" | "refresh" | "check" | "alert" | "partial";

export type RuntimeResultBadgeVariant = "default" | "secondary";

export interface RuntimeResultStatusDisplay {
  status: RuntimeResultStatus;
  label: string;
  colorClass: string;
  bgClass: string;
  iconClass: string;
  icon: RuntimeResultStatusIcon;
  badgeVariant: RuntimeResultBadgeVariant;
  isBusy: boolean;
}

export interface RuntimeResultStatusView extends RuntimeResultStatusDisplay {
  progress: number | null;
}

export interface RuntimeResultEmptyMessages {
  queued: string;
  running: string;
  fallback: string;
}

export const RUNTIME_RESULT_STATUS_DISPLAY: Record<RuntimeResultStatus, RuntimeResultStatusDisplay> = {
  queued: {
    status: "queued",
    label: "Queued",
    colorClass: "text-muted-foreground",
    bgClass: "bg-muted/50",
    iconClass: "",
    icon: "clock",
    badgeVariant: "secondary",
    isBusy: true,
  },
  running: {
    status: "running",
    label: "Running",
    colorClass: "text-chart-2",
    bgClass: "bg-chart-2/10",
    iconClass: "animate-spin",
    icon: "refresh",
    badgeVariant: "secondary",
    isBusy: true,
  },
  completed: {
    status: "completed",
    label: "Completed",
    colorClass: "text-chart-1",
    bgClass: "bg-chart-1/10",
    iconClass: "",
    icon: "check",
    badgeVariant: "default",
    isBusy: false,
  },
  failed: {
    status: "failed",
    label: "Failed",
    colorClass: "text-destructive",
    bgClass: "bg-destructive/10",
    iconClass: "",
    icon: "alert",
    badgeVariant: "secondary",
    isBusy: false,
  },
  partial: {
    status: "partial",
    label: "Partial",
    colorClass: "text-amber-500",
    bgClass: "bg-amber-500/10",
    iconClass: "",
    icon: "partial",
    badgeVariant: "secondary",
    isBusy: false,
  },
} as const;

export function isRuntimeResultStatus(status: string | null | undefined): status is RuntimeResultStatus {
  return status != null && Object.prototype.hasOwnProperty.call(RUNTIME_RESULT_STATUS_DISPLAY, status);
}

export function resolveRuntimeResultStatus(
  status: string | null | undefined,
  fallback: RuntimeResultStatus = "completed",
): RuntimeResultStatus {
  return isRuntimeResultStatus(status) ? status : fallback;
}

export function getRuntimeResultStatusDisplay(status: string | null | undefined): RuntimeResultStatusDisplay {
  return RUNTIME_RESULT_STATUS_DISPLAY[resolveRuntimeResultStatus(status)];
}

export function isBusyRuntimeResultStatus(status: string | null | undefined): boolean {
  return isRuntimeResultStatus(status) && RUNTIME_RESULT_STATUS_DISPLAY[status].isBusy;
}

export function getRuntimeResultStatusProgress(
  status: string | null | undefined,
  progress: number | null | undefined,
): number | null {
  return resolveRuntimeResultStatus(status) === "running" && progress != null ? progress : null;
}

export function buildRuntimeResultStatusView(
  status: string | null | undefined,
  progress?: number | null,
): RuntimeResultStatusView {
  return {
    ...getRuntimeResultStatusDisplay(status),
    progress: getRuntimeResultStatusProgress(status, progress),
  };
}

export function getRuntimeResultEmptyMessage(
  status: string | null | undefined,
  messages: RuntimeResultEmptyMessages,
): string {
  if (status === "running") return messages.running;
  if (status === "queued") return messages.queued;
  return messages.fallback;
}
