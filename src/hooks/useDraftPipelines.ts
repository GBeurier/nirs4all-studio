import { useCallback, useEffect, useState } from "react";
import {
  STORAGE_KEY_PREFIX,
  clearPipelineEditorPersistedState,
  listDirtyPipelineEditorDrafts,
  type PipelineEditorDraftEntry,
} from "@/lib/pipelineEditorPersistence";

export type DraftEntry = PipelineEditorDraftEntry;

function readDrafts(): DraftEntry[] {
  return listDirtyPipelineEditorDrafts();
}

export function useDraftPipelines() {
  const [drafts, setDrafts] = useState<DraftEntry[]>(() => readDrafts());

  const refresh = useCallback(() => {
    setDrafts(readDrafts());
  }, []);

  const discard = useCallback((id: string) => {
    clearPipelineEditorPersistedState(id);
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
