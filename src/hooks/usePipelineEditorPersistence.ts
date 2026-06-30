import { useCallback, useEffect, useMemo, useRef } from "react";

import type { PipelineStep } from "@/components/pipeline-editor/types";
import { migrateStep } from "@/components/pipeline-editor/types";
import {
  clearPipelineEditorPersistedState,
  loadPipelineEditorPersistedState,
  savePipelineEditorPersistedState,
  type PersistedPipelineState,
  type PipelineConfig,
} from "@/lib/pipelineEditorPersistence";
import { hydrateEditorPipelineSteps } from "@/utils/pipelineEditorHydration";

interface ResolvePipelineEditorInitialStateOptions {
  persistedState: PersistedPipelineState | null;
  initialSteps: PipelineStep[];
  initialName: string;
  initialConfig: PipelineConfig;
}

interface PipelineEditorInitialState {
  steps: PipelineStep[];
  pipelineName: string;
  pipelineConfig: PipelineConfig;
  isFavorite: boolean;
}

interface UsePipelineEditorInitialStateOptions {
  initialSteps: PipelineStep[];
  initialName: string;
  initialConfig: PipelineConfig;
  pipelineId: string;
  persistState: boolean;
  allowPersistedState: boolean;
}

interface UsePipelineEditorPersistenceOptions {
  pipelineId: string;
  persistState: boolean;
  steps: PipelineStep[];
  pipelineName: string;
  pipelineConfig: PipelineConfig;
  isFavorite: boolean;
  isDirty: boolean;
}

interface UsePipelineEditorPersistenceReturn {
  clearPersistedData: () => void;
}

export function resolvePipelineEditorInitialState({
  persistedState,
  initialSteps,
  initialName,
  initialConfig,
}: ResolvePipelineEditorInitialStateOptions): PipelineEditorInitialState {
  return {
    steps: persistedState?.steps ?? hydrateEditorPipelineSteps(initialSteps.map(migrateStep)),
    pipelineName: persistedState?.pipelineName ?? initialName,
    pipelineConfig: persistedState?.config ?? initialConfig,
    isFavorite: persistedState?.isFavorite ?? false,
  };
}

export function usePipelineEditorInitialState({
  initialSteps,
  initialName,
  initialConfig,
  pipelineId,
  persistState,
  allowPersistedState,
}: UsePipelineEditorInitialStateOptions): PipelineEditorInitialState {
  const persistedState = useMemo(() => {
    if (!persistState || !allowPersistedState) return null;
    return loadPipelineEditorPersistedState(pipelineId);
  }, [allowPersistedState, pipelineId, persistState]);

  return resolvePipelineEditorInitialState({
    persistedState,
    initialSteps,
    initialName,
    initialConfig,
  });
}

export function usePipelineEditorPersistence({
  pipelineId,
  persistState,
  steps,
  pipelineName,
  pipelineConfig,
  isFavorite,
  isDirty,
}: UsePipelineEditorPersistenceOptions): UsePipelineEditorPersistenceReturn {
  const isInitialMount = useRef(true);

  useEffect(() => {
    if (!persistState) return;

    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    const state: PersistedPipelineState = {
      steps,
      pipelineName,
      isFavorite,
      lastModified: Date.now(),
      config: pipelineConfig,
      isDirty,
    };
    savePipelineEditorPersistedState(pipelineId, state);
  }, [steps, pipelineName, isFavorite, pipelineConfig, pipelineId, persistState, isDirty]);

  const clearPersistedData = useCallback(() => {
    if (persistState) {
      clearPipelineEditorPersistedState(pipelineId);
    }
  }, [pipelineId, persistState]);

  return { clearPersistedData };
}
