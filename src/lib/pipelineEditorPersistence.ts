import type { PipelineStep } from "@/components/pipeline-editor/types";
import { migrateStep } from "@/components/pipeline-editor/stepFactory";
import {
  clientStorageKeyPrefixes,
  listClientStorageItemKeys,
  pipelineEditorDraftStorageKey,
  readClientStorageString,
  removeClientStorageItem,
  writeClientStorageString,
} from "@/lib/clientStorage";
import { hydrateEditorPipelineSteps } from "@/utils/pipelineEditorHydration";

export const STORAGE_KEY_PREFIX = clientStorageKeyPrefixes.pipelineEditorDraft;

export interface PipelineConfig {
  /** Global random seed for reproducibility */
  seed?: number;
  /** Verbose level for training output */
  verbose?: number;
  /** Export model after training */
  exportModel?: boolean;
}

export interface PersistedPipelineState {
  steps: PipelineStep[];
  pipelineName: string;
  isFavorite: boolean;
  lastModified: number;
  config?: PipelineConfig;
  isDirty?: boolean;
}

export interface PipelineEditorDraftEntry {
  id: string;
  state: PersistedPipelineState;
}

export function getPipelineEditorPersistenceKey(pipelineId: string): string {
  return pipelineEditorDraftStorageKey(pipelineId).key;
}

function rethrowClientStorageError(error: unknown): never {
  throw error;
}

function readPipelineEditorDraftRaw(pipelineId: string, storage?: Storage): string | null {
  const key = getPipelineEditorPersistenceKey(pipelineId);
  return storage
    ? storage.getItem(key)
    : readClientStorageString(pipelineEditorDraftStorageKey(pipelineId), {
      onError: rethrowClientStorageError,
    });
}

function writePipelineEditorDraftRaw(pipelineId: string, value: string, storage?: Storage): void {
  const key = getPipelineEditorPersistenceKey(pipelineId);
  if (storage) {
    storage.setItem(key, value);
    return;
  }
  writeClientStorageString(pipelineEditorDraftStorageKey(pipelineId), value, {
    onError: rethrowClientStorageError,
  });
}

function removePipelineEditorDraft(pipelineId: string, storage?: Storage): void {
  const key = getPipelineEditorPersistenceKey(pipelineId);
  if (storage) {
    storage.removeItem(key);
    return;
  }
  removeClientStorageItem(pipelineEditorDraftStorageKey(pipelineId), {
    onError: rethrowClientStorageError,
  });
}

function listPipelineEditorDraftKeys(storage?: Storage): string[] {
  if (!storage) {
    return listClientStorageItemKeys("local", {
      onError: rethrowClientStorageError,
    }).filter(key => key.startsWith(STORAGE_KEY_PREFIX));
  }

  const keys: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.startsWith(STORAGE_KEY_PREFIX)) {
      keys.push(key);
    }
  }
  return keys;
}

export function loadPipelineEditorPersistedState(
  pipelineId: string,
  storage: Storage | undefined = undefined,
): PersistedPipelineState | null {
  try {
    const stored = readPipelineEditorDraftRaw(pipelineId, storage);
    if (!stored) return null;

    const state = JSON.parse(stored) as PersistedPipelineState;
    if (!Array.isArray(state.steps)) {
      state.steps = [];
    }
    if (state.steps.length > 0) {
      state.steps = hydrateEditorPipelineSteps(state.steps.map(migrateStep));
    }
    if (
      state.isDirty !== true &&
      state.steps.length === 0 &&
      typeof state.pipelineName === "string" &&
      state.pipelineName.toLowerCase().startsWith("loading pipeline")
    ) {
      clearPipelineEditorPersistedState(pipelineId, storage);
      return null;
    }
    return state;
  } catch (e) {
    console.warn("Failed to load persisted pipeline state:", e);
  }
  return null;
}

export function savePipelineEditorPersistedState(
  pipelineId: string,
  state: PersistedPipelineState,
  storage: Storage | undefined = undefined,
): void {
  try {
    writePipelineEditorDraftRaw(pipelineId, JSON.stringify(state), storage);
  } catch (e) {
    console.warn("Failed to persist pipeline state:", e);
  }
}

export function clearPipelineEditorPersistedState(
  pipelineId: string,
  storage: Storage | undefined = undefined,
): void {
  try {
    removePipelineEditorDraft(pipelineId, storage);
  } catch (e) {
    console.warn("Failed to clear persisted pipeline state:", e);
  }
}

export function hasPersistedPipelineEditorState(
  pipelineId: string,
  storage: Storage | undefined = undefined,
): boolean {
  return loadPipelineEditorPersistedState(pipelineId, storage)?.isDirty === true;
}

export function migratePipelineEditorDraftKey(
  oldId: string,
  newId: string,
  storage: Storage | undefined = undefined,
): void {
  if (oldId === newId) return;
  try {
    const state = loadPipelineEditorPersistedState(oldId, storage);
    clearPipelineEditorPersistedState(oldId, storage);
    if (state) {
      savePipelineEditorPersistedState(newId, state, storage);
    }
  } catch (e) {
    console.warn("Failed to migrate draft key:", e);
  }
}

export function listDirtyPipelineEditorDrafts(
  storage: Storage | undefined = undefined,
): PipelineEditorDraftEntry[] {
  const drafts: PipelineEditorDraftEntry[] = [];
  try {
    for (const key of listPipelineEditorDraftKeys(storage)) {
      const raw = readPipelineEditorDraftRaw(key.slice(STORAGE_KEY_PREFIX.length), storage);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as PersistedPipelineState;
        if (parsed.isDirty !== true) continue;
        drafts.push({
          id: key.slice(STORAGE_KEY_PREFIX.length),
          state: {
            steps: Array.isArray(parsed.steps) ? parsed.steps : [],
            pipelineName: parsed.pipelineName || "Untitled pipeline",
            isFavorite: !!parsed.isFavorite,
            lastModified: typeof parsed.lastModified === "number" ? parsed.lastModified : 0,
            config: parsed.config,
            isDirty: true,
          },
        });
      } catch {
        // Ignore malformed entries while keeping other drafts visible.
      }
    }
  } catch (e) {
    console.warn("Failed to scan pipeline drafts:", e);
  }
  return drafts.sort((a, b) => b.state.lastModified - a.state.lastModified);
}
