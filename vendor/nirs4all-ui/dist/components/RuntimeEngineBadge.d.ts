import type { ReactNode } from "react";
import { type RuntimeEngineLineage, type RuntimeEngineStatusView } from "../runtime/index.js";
export interface RuntimeEngineBadgeProps {
    lineage?: RuntimeEngineLineage | null;
    source?: unknown;
    status?: RuntimeEngineStatusView | null;
    label?: string | null;
    icon?: ReactNode;
    defaultIcon?: ReactNode;
    fallbackIcon?: ReactNode;
    className?: string;
    title?: string;
}
export declare function RuntimeEngineBadge({ lineage, source, status, label, icon, defaultIcon, fallbackIcon, className, title, }: RuntimeEngineBadgeProps): import("react").JSX.Element | null;
//# sourceMappingURL=RuntimeEngineBadge.d.ts.map