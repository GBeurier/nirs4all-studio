/**
 * SynthesisPreviewContext
 *
 * Manages the preview state for synthetic data generation:
 * - Preview data (spectra, wavelengths, targets)
 * - Loading states
 * - Preview mode (real-time vs on-demand)
 * - Statistics
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useSynthesisBuilder } from "./SynthesisBuilderContext";
import { api } from "@/api/client";

// ============= Types =============

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

interface SynthesisPreviewState {
  data: PreviewData | null;
  isLoading: boolean;
  error: string | null;
  lastGenerated: Date | null;
  mode: PreviewMode;
}

// ============= Context =============

interface SynthesisPreviewContextValue {
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

const SynthesisPreviewContext = createContext<SynthesisPreviewContextValue | null>(null);

// ============= API Functions =============

interface PreviewRequest {
  config: {
    name: string;
    n_samples: number;
    random_state: number | null;
    steps: Array<{
      id: string;
      type: string;
      method: string;
      params: Record<string, unknown>;
      enabled: boolean;
    }>;
  };
  preview_samples: number;
  include_statistics: boolean;
}

interface PreviewResponse {
  success: boolean;
  spectra: number[][];
  wavelengths: number[];
  targets: number[];
  target_type: "regression" | "classification";
  statistics: PreviewStatistics | null;
  execution_time_ms: number;
  actual_samples: number;
  error?: string;
}

async function fetchPreview(request: PreviewRequest): Promise<PreviewResponse> {
  return api.post<PreviewResponse>("/synthesis/preview", request);
}

// ============= Provider =============

interface SynthesisPreviewProviderProps {
  children: ReactNode;
  defaultMode?: PreviewMode;
  previewSamples?: number;
}

export function SynthesisPreviewProvider({
  children,
  defaultMode = "on-demand",
  previewSamples = 100,
}: SynthesisPreviewProviderProps) {
  const { state: builderState, exportConfig } = useSynthesisBuilder();

  const [state, setState] = useState<SynthesisPreviewState>({
    data: null,
    isLoading: false,
    error: null,
    lastGenerated: null,
    mode: defaultMode,
  });

  // Abort controller for cancelling requests
  const abortControllerRef = useRef<AbortController | null>(null);

  // Generate preview
  const generatePreview = useCallback(async () => {
    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setState((prev) => ({
      ...prev,
      isLoading: true,
      error: null,
    }));

    try {
      const config = exportConfig();

      // Filter to only enabled steps
      const enabledSteps = config.steps.filter((s) => s.enabled);

      if (enabledSteps.length === 0) {
        throw new Error("No steps enabled. Add at least a Features step.");
      }

      const request: PreviewRequest = {
        config: {
          ...config,
          steps: enabledSteps,
        },
        preview_samples: previewSamples,
        include_statistics: true,
      };

      const response = await fetchPreview(request);

      if (!response.success) {
        throw new Error(response.error || "Preview generation failed");
      }

      setState((prev) => ({
        ...prev,
        data: {
          spectra: response.spectra,
          wavelengths: response.wavelengths,
          targets: response.targets,
          target_type: response.target_type,
          statistics: response.statistics,
          execution_time_ms: response.execution_time_ms,
          actual_samples: response.actual_samples,
        },
        isLoading: false,
        error: null,
        lastGenerated: new Date(),
      }));
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return; // Ignore aborted requests
      }

      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }));
    }
  }, [exportConfig, previewSamples]);

  // Clear preview
  const clearPreview = useCallback(() => {
    setState((prev) => ({
      ...prev,
      data: null,
      error: null,
    }));
  }, []);

  // Set mode
  const setMode = useCallback((mode: PreviewMode) => {
    setState((prev) => ({
      ...prev,
      mode,
    }));
  }, []);

  // Computed
  const hasData = state.data !== null;
  const canGenerate = builderState.errors.length === 0 && builderState.steps.some((s) => s.enabled);

  const value = useMemo<SynthesisPreviewContextValue>(
    () => ({
      state,
      generatePreview,
      clearPreview,
      setMode,
      hasData,
      canGenerate,
    }),
    [state, generatePreview, clearPreview, setMode, hasData, canGenerate]
  );

  return (
    <SynthesisPreviewContext.Provider value={value}>
      {children}
    </SynthesisPreviewContext.Provider>
  );
}

// ============= Hooks =============

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
