import { useCallback, useEffect, useState } from "react";
import {
  STORAGE_KEY_PREFIX,
  clearPersistedState,
  type PersistedPipelineState,
} from "./usePipelineEditor";

export interface DraftEntry {
  id: string;
  state: PersistedPipelineState;
}

function readDrafts(): DraftEntry[] {
  const drafts: DraftEntry[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(STORAGE_KEY_PREFIX)) continue;
      const raw = localStorage.getItem(key);
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
        // ignore malformed entries
      }
    }
  } catch (e) {
    console.warn("Failed to scan pipeline drafts:", e);
  }
  return drafts.sort((a, b) => b.state.lastModified - a.state.lastModified);
}

export function useDraftPipelines() {
  const [drafts, setDrafts] = useState<DraftEntry[]>(() => readDrafts());

  const refresh = useCallback(() => {
    setDrafts(readDrafts());
  }, []);

  const discard = useCallback((id: string) => {
    clearPersistedState(id);
    setDrafts((prev) => prev.filter((d) => d.id !== id));
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key.startsWith(STORAGE_KEY_PREFIX)) {
        refresh();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refresh]);

  return { drafts, refresh, discard };
}
