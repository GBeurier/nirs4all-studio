import { createContext, useContext } from "react";

export interface PreviewStatistics {
  spectra_mean: number;
  spectra_std: number;
  spectra_min: number;
  spectra_max: number;
  targets_mean: number;
  targets_std: number;
  targets_min: number;
  targets_max: number;
  n_wavelengths: number;
  n_components?: number;
  class_distribution?: Record<string, number>;
}

export interface PreviewData {
  spectra: number[][];
  wavelengths: number[];
  targets: number[];
  target_type: "regression" | "classification";
  statistics: PreviewStatistics | null;
  execution_time_ms: number;
  actual_samples: number;
}

export type PreviewMode = "realtime" | "on-demand";

export interface SynthesisPreviewState {
  data: PreviewData | null;
  isLoading: boolean;
  error: string | null;
  lastGenerated: Date | null;
  mode: PreviewMode;
}

export interface SynthesisPreviewContextValue {
  // State
  state: SynthesisPreviewState;

  // Actions
  generatePreview: () => Promise<void>;
  clearPreview: () => void;
  setMode: (mode: PreviewMode) => void;

  // Computed
  hasData: boolean;
  canGenerate: boolean;
}

export const SynthesisPreviewContext = createContext<SynthesisPreviewContextValue | null>(null);

export function useSynthesisPreview(): SynthesisPreviewContextValue {
  const context = useContext(SynthesisPreviewContext);
  if (!context) {
    throw new Error("useSynthesisPreview must be used within a SynthesisPreviewProvider");
  }
  return context;
}

export function useSynthesisPreviewOptional(): SynthesisPreviewContextValue | null {
  return useContext(SynthesisPreviewContext);
}
