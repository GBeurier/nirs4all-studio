/** Mirrors the Python environment state owned by the Electron main process. */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { resetBackendUrl } from "@/api/transport";
import { PythonEnvContext, type PythonEnvContextValue } from "@/context/usePythonEnv";
import { clientStorageKeys, readClientStorageString, writeClientStorageString } from "@/lib/clientStorage";
import { dispatchOperatorAvailabilityInvalidated } from "@/lib/pipelineOperatorAvailability";
import type { PythonEnvState } from "@/types/pythonEnvironment";

export function PythonEnvProvider({ children }: { children: ReactNode }) {
  const [api] = useState(() => window.electronApi?.pythonEnv ?? null);
  const [state, setState] = useState<PythonEnvState | null>(null);
  // Kept for the session so a window reload does not reopen the setup page.
  const [setupSkipped, setSetupSkipped] = useState(
    () => readClientStorageString(clientStorageKeys.pythonSetupSkipped) === "true",
  );

  useEffect(() => {
    if (!api) return;
    let disposed = false;
    const unsubscribe = api.onState(setState);
    api.getState()
      // A pushed state that arrived first is newer than this answer.
      .then((initial) => { if (!disposed) setState((current) => current ?? initial); })
      .catch((error: unknown) => {
        console.warn("[PythonEnvProvider] Could not read the Python environment state:", error);
      });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [api]);

  const run = useCallback<PythonEnvContextValue["run"]>(async (action) => {
    if (!api) throw new Error("Python environment management is unavailable");
    const result = await action(api);
    setState(result.state);
    if (result.hostRestarted) {
      // Also after a failure: a rolled-back switch restarts the backend on the previous environment.
      resetBackendUrl();
      dispatchOperatorAvailabilityInvalidated();
      window.dispatchEvent(new CustomEvent("backend-restarted"));
    }
    return result;
  }, [api]);

  const skipSetup = useCallback(() => {
    writeClientStorageString(clientStorageKeys.pythonSetupSkipped, "true");
    setSetupSkipped(true);
  }, []);

  const value = useMemo(
    () => ({ api, state, setupSkipped, skipSetup, run }),
    [api, state, setupSkipped, skipSetup, run],
  );

  return <PythonEnvContext.Provider value={value}>{children}</PythonEnvContext.Provider>;
}
