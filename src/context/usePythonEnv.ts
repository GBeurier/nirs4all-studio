import { createContext, useContext } from "react";
import type {
  PythonEnvActionResult,
  PythonEnvApi,
  PythonEnvState,
} from "@/types/pythonEnvironment";

export interface PythonEnvContextValue {
  /** Null outside Electron, where the deployment manages the environment. */
  api: PythonEnvApi | null;
  /** Null outside Electron and until the main process has answered. */
  state: PythonEnvState | null;
  /** The user chose to continue without Python in this session (survives a window reload). */
  setupSkipped: boolean;
  skipSetup: () => void;
  /** Runs an environment action and adopts the state it returns. */
  run: (action: (api: PythonEnvApi) => Promise<PythonEnvActionResult>) => Promise<PythonEnvActionResult>;
}

export const PythonEnvContext = createContext<PythonEnvContextValue>({
  api: null,
  state: null,
  setupSkipped: false,
  skipSetup: () => {},
  run: () => Promise.reject(new Error("Python environment management is unavailable")),
});

export function usePythonEnv(): PythonEnvContextValue {
  return useContext(PythonEnvContext);
}

/** Drives the indicator dots on the Settings entry and on its Python tab. */
export function pythonEnvNeedsReview(state: PythonEnvState | null): boolean {
  return state?.phase === "needs_attention" || (state?.selected?.outdatedRecommendedCount ?? 0) > 0;
}
