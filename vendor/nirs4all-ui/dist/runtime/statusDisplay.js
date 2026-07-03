/**
 * Pure runtime/result status display helpers.
 *
 * This module owns the reusable view-model tokens for run and pipeline result
 * status rendering. React components map `icon` onto host-specific icon
 * components; the foundation stays framework-free.
 */
export const RUNTIME_RESULT_STATUSES = ["queued", "running", "completed", "failed", "partial"];
export const RUNTIME_RESULT_STATUS_DISPLAY = {
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
};
export function isRuntimeResultStatus(status) {
    return status != null && Object.prototype.hasOwnProperty.call(RUNTIME_RESULT_STATUS_DISPLAY, status);
}
export function resolveRuntimeResultStatus(status, fallback = "completed") {
    return isRuntimeResultStatus(status) ? status : fallback;
}
export function getRuntimeResultStatusDisplay(status) {
    return RUNTIME_RESULT_STATUS_DISPLAY[resolveRuntimeResultStatus(status)];
}
export function isBusyRuntimeResultStatus(status) {
    return isRuntimeResultStatus(status) && RUNTIME_RESULT_STATUS_DISPLAY[status].isBusy;
}
export function getRuntimeResultStatusProgress(status, progress) {
    return resolveRuntimeResultStatus(status) === "running" && progress != null ? progress : null;
}
export function buildRuntimeResultStatusView(status, progress) {
    return {
        ...getRuntimeResultStatusDisplay(status),
        progress: getRuntimeResultStatusProgress(status, progress),
    };
}
export function getRuntimeResultEmptyMessage(status, messages) {
    if (status === "running")
        return messages.running;
    if (status === "queued")
        return messages.queued;
    return messages.fallback;
}
//# sourceMappingURL=statusDisplay.js.map