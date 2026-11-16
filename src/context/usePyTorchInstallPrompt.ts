import { createContext, useCallback, useContext, useEffect, useRef } from "react";
import type { PyTorchNeed } from "@/lib/pytorchRequirement";

export interface PyTorchInstallPromptValue {
  /**
   * PyTorch is missing and Studio can install it in the selected environment.
   * Always false outside the desktop application and for read-only environments.
   */
  canInstall: boolean;
  /** Asks the user to install PyTorch; `proceed` runs once it is installed, never otherwise. */
  request: (need: PyTorchNeed, proceed: () => void) => void;
}

export const PyTorchInstallPromptContext = createContext<PyTorchInstallPromptValue>({
  canInstall: false,
  request: (_need, proceed) => proceed(),
});

export function usePyTorchInstallPrompt(): PyTorchInstallPromptValue {
  return useContext(PyTorchInstallPromptContext);
}

/**
 * Wraps `action` so it first asks to install PyTorch when `needOf` says the
 * call depends on it and Studio can install it. After the installation the
 * current `action` runs with the original arguments; it does not run when the
 * user declines, the installation fails, or the caller has unmounted.
 */
export function usePyTorchGate<Args extends unknown[], Result>(
  action: (...args: Args) => Result,
  needOf: (...args: Args) => PyTorchNeed | null,
): (...args: Args) => Result | undefined {
  const { canInstall, request } = usePyTorchInstallPrompt();
  const latest = useRef<{ action: typeof action; needOf: typeof needOf } | null>(null);

  useEffect(() => {
    latest.current = { action, needOf };
    return () => {
      latest.current = null;
    };
  });

  return useCallback((...args: Args) => {
    const current = latest.current;
    if (!current) return undefined;
    const need = canInstall ? current.needOf(...args) : null;
    if (!need) return current.action(...args);
    request(need, () => {
      latest.current?.action(...args);
    });
    return undefined;
  }, [canInstall, request]);
}
