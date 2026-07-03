import { jsxs as _jsxs } from "react/jsx-runtime";
import { buildRuntimeEngineStatus, formatRuntimeEngineTitle, runtimeEngineLabel, } from "../runtime/index.js";
export function RuntimeEngineBadge({ lineage, source, status, label, icon, defaultIcon, fallbackIcon, className, title, }) {
    const engineStatus = status ?? buildRuntimeEngineStatus(source);
    const text = label ?? engineStatus?.badgeLabel ?? runtimeEngineLabel(lineage);
    if (!text)
        return null;
    const resolvedIcon = icon ?? (engineStatus?.isFallback ? fallbackIcon : defaultIcon);
    const resolvedTitle = title ?? formatRuntimeEngineTitle(engineStatus) ?? undefined;
    return (_jsxs("span", { className: className, title: resolvedTitle, children: [resolvedIcon, text] }));
}
//# sourceMappingURL=RuntimeEngineBadge.js.map