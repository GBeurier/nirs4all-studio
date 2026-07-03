/**
 * Pure runtime/result status display helpers.
 *
 * This module owns the reusable view-model tokens for run and pipeline result
 * status rendering. React components map `icon` onto host-specific icon
 * components; the foundation stays framework-free.
 */
export declare const RUNTIME_RESULT_STATUSES: readonly ["queued", "running", "completed", "failed", "partial"];
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
export declare const RUNTIME_RESULT_STATUS_DISPLAY: Record<RuntimeResultStatus, RuntimeResultStatusDisplay>;
export declare function isRuntimeResultStatus(status: string | null | undefined): status is RuntimeResultStatus;
export declare function resolveRuntimeResultStatus(status: string | null | undefined, fallback?: RuntimeResultStatus): RuntimeResultStatus;
export declare function getRuntimeResultStatusDisplay(status: string | null | undefined): RuntimeResultStatusDisplay;
export declare function isBusyRuntimeResultStatus(status: string | null | undefined): boolean;
export declare function getRuntimeResultStatusProgress(status: string | null | undefined, progress: number | null | undefined): number | null;
export declare function buildRuntimeResultStatusView(status: string | null | undefined, progress?: number | null): RuntimeResultStatusView;
export declare function getRuntimeResultEmptyMessage(status: string | null | undefined, messages: RuntimeResultEmptyMessages): string;
//# sourceMappingURL=statusDisplay.d.ts.map