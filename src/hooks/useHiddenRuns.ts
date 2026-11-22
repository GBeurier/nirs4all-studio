import { useCallback, useSyncExternalStore } from "react";

import { clientStorageKeys, readClientStorageJson, writeClientStorageJson } from "@/lib/clientStorage";

/**
 * Runs removed from the Runs history list only. Their results, predictions and
 * artifacts stay in the workspace and remain visible on the other screens.
 */
const listeners = new Set<() => void>();
let hiddenKeys: string[] = readHiddenKeys();

function readHiddenKeys(): string[] {
  const stored = readClientStorageJson(clientStorageKeys.hiddenWorkspaceRuns);
  return Array.isArray(stored) ? stored.filter((key): key is string => typeof key === "string") : [];
}

function hiddenRunKey(workspaceId: string, runId: string): string {
  return `${workspaceId}::${runId}`;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return hiddenKeys;
}

export function hideRunsFromHistory(workspaceId: string, runIds: readonly string[]) {
  hiddenKeys = [...new Set([...hiddenKeys, ...runIds.map(runId => hiddenRunKey(workspaceId, runId))])];
  writeClientStorageJson(clientStorageKeys.hiddenWorkspaceRuns, hiddenKeys);
  listeners.forEach(listener => listener());
}

export function useHiddenRuns(workspaceId: string | undefined) {
  const keys = useSyncExternalStore(subscribe, getSnapshot);
  const isHidden = useCallback(
    (runId: string) => !!workspaceId && keys.includes(hiddenRunKey(workspaceId, runId)),
    [keys, workspaceId],
  );
  return { isHidden };
}
