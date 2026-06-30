import { createContext, useContext } from "react";

/**
 * Tier level for operator visibility filtering.
 * - "core": show only essential NIRS operators (~28)
 * - "standard": core + standard operators (~122) - default
 * - "all": everything including advanced/deep learning (~150+)
 */
export type TierLevel = "core" | "standard" | "all";

export interface PipelineEditorPreferences {
  /** @deprecated Use tierLevel instead. Kept for backwards compatibility. */
  extendedMode: boolean;
  /** @deprecated Use setTierLevel instead. */
  setExtendedMode: (value: boolean) => void;
  /** Current tier level for operator visibility */
  tierLevel: TierLevel;
  /** Set the tier level */
  setTierLevel: (value: TierLevel) => void;
  /** Whether unavailable operators should stay visible in the palette */
  showUnavailableOperators: boolean;
  /** Toggle unavailable operator visibility in the palette */
  setShowUnavailableOperators: (value: boolean) => void;
}

export const PipelineEditorPreferencesContext = createContext<PipelineEditorPreferences | undefined>(
  undefined
);

export function usePipelineEditorPreferences(): PipelineEditorPreferences {
  const ctx = useContext(PipelineEditorPreferencesContext);
  if (!ctx) {
    throw new Error(
      "usePipelineEditorPreferences must be used within a PipelineEditorPreferencesProvider"
    );
  }
  return ctx;
}

export function usePipelineEditorPreferencesOptional(): PipelineEditorPreferences | null {
  return useContext(PipelineEditorPreferencesContext) ?? null;
}
