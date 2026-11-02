import type { TFunction } from "i18next";
import { describeApiError } from "@/lib/userFacingError";
import type { DesktopEnvInfo, DesktopRuntimeFallback } from "@/types/pythonRuntime";

/** Explain why this session runs the included runtime instead of the selected environment. */
export function describeRuntimeFallback(fallback: DesktopRuntimeFallback, t: TFunction): string {
  const cause = fallback.reason === "missing"
    ? t("common.pythonEnv.fallback.missing", { path: fallback.selectedPythonPath })
    : t("common.pythonEnv.fallback.incompatible", { path: fallback.selectedPythonPath, issues: fallback.issues.join("; ") });
  return `${cause} ${t("common.pythonEnv.fallback.summary")}`;
}

export interface PythonRuntimeNotice {
  kind: "fallback" | "unavailable";
  title: string;
  message: string;
}

interface ScientificReadiness {
  controlReady: boolean;
  mlReady: boolean;
  mlLoading: boolean;
  mlError: string | null;
}

/**
 * Persistent desktop notice: the included runtime replaced the selection, or
 * setup was deferred while the scientific runtime is not ready. Deferring
 * setup skips the startup redirect but must not hide a broken runtime.
 */
export function buildPythonRuntimeNotice(
  envInfo: DesktopEnvInfo | null,
  readiness: ScientificReadiness,
  t: TFunction,
): PythonRuntimeNotice | null {
  if (!envInfo) return null;
  if (envInfo.runtimeFallback) {
    return {
      kind: "fallback",
      title: t("common.pythonEnv.fallback.title"),
      message: describeRuntimeFallback(envInfo.runtimeFallback, t),
    };
  }
  const settled = readiness.controlReady && !readiness.mlReady && (Boolean(readiness.mlError) || !readiness.mlLoading);
  if (envInfo.setupDeferred && settled) {
    const fallbackReason = t("layout.pythonRuntime.unavailableReason");
    // Readiness errors can be machine reasons (e.g. "executor_not_selected").
    const readinessReason = readiness.mlError
      ? describeApiError({ reason: readiness.mlError, detail: readiness.mlError }, t, fallbackReason).message
      : null;
    return {
      kind: "unavailable",
      title: t("layout.pythonRuntime.unavailableTitle"),
      message: envInfo.error ?? envInfo.pythonHostError ?? readinessReason ?? fallbackReason,
    };
  }
  return null;
}
