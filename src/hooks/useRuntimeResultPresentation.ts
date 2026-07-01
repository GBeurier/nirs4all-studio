import { useMemo } from "react";

import {
  buildRuntimeEngineStatus,
  buildRuntimeNativeResultsAffordance,
  buildRuntimeResultStatusView,
  normalizeRuntimeDiagnostics,
  type RuntimeNativeResultsAffordanceInput,
} from "@/ui/runtime";

export interface UseRuntimeResultPresentationInput extends RuntimeNativeResultsAffordanceInput {
  source?: unknown;
  status?: string | null;
  progress?: number | null;
}

export function useRuntimeResultPresentation({
  source,
  status,
  progress,
  artifactCount,
  nativeArtifactCount,
  hasNativeResults,
  hasRefit,
  exportLabel,
  exportDescription,
  disabled,
  disabledReason,
}: UseRuntimeResultPresentationInput) {
  return useMemo(() => ({
    status: buildRuntimeResultStatusView(status, progress),
    engine: buildRuntimeEngineStatus(source),
    diagnostics: normalizeRuntimeDiagnostics(source),
    nativeResults: buildRuntimeNativeResultsAffordance({
      artifactCount,
      nativeArtifactCount,
      hasNativeResults,
      hasRefit,
      exportLabel,
      exportDescription,
      disabled,
      disabledReason,
    }),
  }), [
    source,
    status,
    progress,
    artifactCount,
    nativeArtifactCount,
    hasNativeResults,
    hasRefit,
    exportLabel,
    exportDescription,
    disabled,
    disabledReason,
  ]);
}
