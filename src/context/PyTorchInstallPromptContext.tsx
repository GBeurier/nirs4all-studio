/** The one PyTorch installation prompt of the application, shared by every entry point. */
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { PyTorchInstallDialog, type PyTorchInstallStatus } from "@/components/python-env/PyTorchInstallDialog";
import { usePythonEnv } from "@/context/usePythonEnv";
import { PyTorchInstallPromptContext, type PyTorchInstallPromptValue } from "@/context/usePyTorchInstallPrompt";
import { PYTORCH_PACKAGE, lacksInstallablePyTorch, type PyTorchNeed } from "@/lib/pytorchRequirement";

export function PyTorchInstallPromptProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { state, run } = usePythonEnv();
  const [need, setNeed] = useState<PyTorchNeed | null>(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<PyTorchInstallStatus>("asking");
  const [failure, setFailure] = useState<string | null>(null);
  // Read synchronously by `request` and by the end of an installation.
  const openRef = useRef(false);
  const installingRef = useRef(false);
  // What to do once PyTorch is installed, one entry per distinct need.
  const pending = useRef(new Map<string, () => void>());

  const show = useCallback((visible: boolean) => {
    openRef.current = visible;
    setOpen(visible);
  }, []);

  const request = useCallback<PyTorchInstallPromptValue["request"]>((nextNeed, proceed) => {
    // The dialog is modal: a request while it is open is the same selection delivered twice.
    if (openRef.current) return;
    pending.current.set(nextNeed.kind === "model" ? `model:${nextNeed.name}` : nextNeed.kind, proceed);
    setNeed(nextNeed);
    show(true);
  }, [show]);

  const install = useCallback(async () => {
    if (installingRef.current) return;
    installingRef.current = true;
    setStatus("installing");
    let error: string | null = null;
    try {
      const result = await run((api) => api.installPackages([PYTORCH_PACKAGE]));
      if (!result.success) error = result.message ?? t("pythonEnv.pytorch.failedUnknown");
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    installingRef.current = false;

    if (error === null) {
      const proceed = [...pending.current.values()];
      pending.current.clear();
      show(false);
      setStatus("asking");
      toast.success(t("pythonEnv.pytorch.installed"));
      proceed.forEach((action) => action());
    } else if (openRef.current) {
      setFailure(error);
      setStatus("failed");
    } else {
      // Sent to the background: report the failure without reopening the dialog.
      pending.current.clear();
      setStatus("asking");
      toast.error(t("pythonEnv.pytorch.failedTitle"), { description: error });
    }
  }, [run, show, t]);

  const dismiss = useCallback(() => {
    show(false);
    if (installingRef.current) return;
    pending.current.clear();
    setStatus("asking");
  }, [show]);

  // The selected environment stays the target while this prompt installs into it.
  const canInstall = (state?.phase === "ready" || status === "installing")
    && lacksInstallablePyTorch(state?.selected);
  const value = useMemo(() => ({ canInstall, request }), [canInstall, request]);

  return (
    <PyTorchInstallPromptContext.Provider value={value}>
      {children}
      {need && (
        <PyTorchInstallDialog
          open={open}
          need={need}
          status={status}
          environmentPath={state?.selected?.envRoot ?? null}
          activity={state?.activity}
          failure={failure}
          onInstall={() => void install()}
          onDismiss={dismiss}
        />
      )}
    </PyTorchInstallPromptContext.Provider>
  );
}
