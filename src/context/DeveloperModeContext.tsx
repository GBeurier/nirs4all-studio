/**
 * Developer Mode Context
 *
 * Provides application-wide access to developer mode state.
 * Developer mode enables additional features like synthetic data generation,
 * debug information, and advanced options.
 *
 * Phase 6 Implementation
 */

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { getAppSettings, updateAppSettings } from "@/api/appSettings";
import { getWorkspaceSettings } from "@/api/workspace";
import {
  DeveloperModeContext,
  type DeveloperModeContextType,
} from "@/context/useDeveloperMode";

interface DeveloperModeProviderProps {
  children: ReactNode;
}

// Match the application's existing startup retry policy. Reads also have an
// overall deadline, including preselection IPC and any legacy workspace read.
const MAX_LOAD_RETRIES = 8;
const LOAD_DEADLINE_MS = 90_000;

function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Settings read cancelled", "AbortError"));
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
  });
}

function waitForRetry(delay: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, delay);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}

async function readAppSettings(signal: AbortSignal) {
  for (let attempt = 0; ; attempt += 1) {
    if (signal.aborted) throw new DOMException("Settings read cancelled", "AbortError");
    try {
      return await withAbort(getAppSettings(signal), signal);
    } catch (error) {
      const status = error && typeof error === "object" && "status" in error ? error.status : null;
      if (signal.aborted || attempt >= MAX_LOAD_RETRIES || (status !== 503 && status !== 0)) throw error;
      await waitForRetry(Math.min(1500 * 2 ** attempt, 15000), signal);
    }
  }
}

export function DeveloperModeProvider({ children }: DeveloperModeProviderProps) {
  const [isDeveloperMode, setIsDeveloperMode] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const readController = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const writeRevision = useRef(0);
  const writesInFlight = useRef(0);
  const confirmedValue = useRef(false);
  const writeQueue = useRef<Promise<unknown>>(Promise.resolve());

  // Load developer mode setting from backend
  const loadDeveloperMode = useCallback(async () => {
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    const currentRevision = ++revision.current;
    const beganDuringWrite = writesInFlight.current > 0;
    const deadline = setTimeout(() => controller.abort(), LOAD_DEADLINE_MS);
    try {
      setIsLoading(true);
      const settings = await readAppSettings(controller.signal);
      const enabled = settings.ui_preferences.developer_mode
        ?? (await withAbort(getWorkspaceSettings().catch(() => null), controller.signal))?.developer_mode
        ?? false;
      if (!controller.signal.aborted && currentRevision === revision.current
        && !beganDuringWrite && writesInFlight.current === 0) {
        confirmedValue.current = enabled;
        setIsDeveloperMode(enabled);
      }
    } catch {
      // An unavailable read is not evidence that the saved preference is false.
      // Keep the previous value; an initial load still defaults to disabled.
    } finally {
      clearTimeout(deadline);
      if (currentRevision === revision.current) {
        readController.current = null;
        setIsLoading(false);
      }
    }
  }, []);

  // Load on mount
  useEffect(() => {
    void loadDeveloperMode();
    return () => { revision.current += 1; writeRevision.current += 1; readController.current?.abort(); };
  }, [loadDeveloperMode]);

  // Set developer mode and persist to backend
  const setDeveloperModeValue = useCallback(async (enabled: boolean) => {
    const currentWrite = ++writeRevision.current;
    revision.current += 1;
    readController.current?.abort();
    readController.current = null;
    setIsLoading(false);
    writesInFlight.current += 1;
    try {
      setIsDeveloperMode(enabled);
      // Preserve user intent order in the actual store as well as the UI.
      // A refused write does not stop later choices and is never retried.
      const saving = writeQueue.current.then(() =>
        updateAppSettings({ ui_preferences: { developer_mode: enabled } }));
      writeQueue.current = saving.catch(() => undefined);
      await saving;
      confirmedValue.current = enabled;
    } catch (error) {
      // Revert on error
      if (currentWrite === writeRevision.current) setIsDeveloperMode(confirmedValue.current);
      console.error("Failed to update developer mode:", error);
      throw error;
    } finally {
      writesInFlight.current -= 1;
    }
  }, []);

  // Toggle developer mode
  const toggleDeveloperMode = useCallback(async () => {
    await setDeveloperModeValue(!isDeveloperMode);
  }, [isDeveloperMode, setDeveloperModeValue]);

  // Refresh from backend
  const refresh = useCallback(async () => {
    await loadDeveloperMode();
  }, [loadDeveloperMode]);

  const value: DeveloperModeContextType = {
    isDeveloperMode,
    isLoading,
    toggleDeveloperMode,
    setDeveloperMode: setDeveloperModeValue,
    refresh,
  };

  return (
    <DeveloperModeContext.Provider value={value}>
      {children}
    </DeveloperModeContext.Provider>
  );
}
