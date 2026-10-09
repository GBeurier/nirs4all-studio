import { useCallback, useMemo } from "react";

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
import { useDebouncedWrite } from "./useDebouncedWrite";

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
  isDirty: boolean;
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
    isDirty: persistedState?.isDirty ?? false,
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
  const write = useMemo(() => {
    if (!persistState) return null;
    return () => savePipelineEditorPersistedState(pipelineId, {
      steps,
      pipelineName,
      isFavorite,
      lastModified: Date.now(),
      config: pipelineConfig,
      isDirty,
    });
  }, [steps, pipelineName, isFavorite, pipelineConfig, pipelineId, persistState, isDirty]);

  const { cancel } = useDebouncedWrite(write, { skipInitialWrite: true, scopeKey: pipelineId });

  const clearPersistedData = useCallback(() => {
    if (persistState) {
      cancel();
      clearPipelineEditorPersistedState(pipelineId);
    }
  }, [pipelineId, persistState, cancel]);

  return { clearPersistedData };
}
