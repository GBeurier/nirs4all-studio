/**
 * Overlay shown on pages that require ML dependencies when they are not yet loaded.
 * Renders children blurred with a centered loading indicator on top.
 * Disappears automatically when mlReady becomes true.
 */

import { useMlReadiness } from "@/context/useMlReadiness";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { restartChangedPythonRuntime } from "@/lib/pythonRuntimeSwitch";

export function MlLoadingOverlay({ children }: { children: React.ReactNode }) {
  const { mlReady, mlLoading, mlError, requiresRestart, dependencyInstalling, restartReason } = useMlReadiness();
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const { t } = useTranslation();

  if (mlReady) return <>{children}</>;

  return (
    <div className="relative h-full">
      {/* Render children but blur and disable interaction */}
      <div className="h-full opacity-30 pointer-events-none blur-sm">
        {children}
      </div>
      {/* Overlay */}
      <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm z-50">
        <div className="flex flex-col items-center gap-4 p-8 rounded-xl bg-card border shadow-lg max-w-md text-center">
          {requiresRestart && !dependencyInstalling ? (
            <div role="status" className="space-y-3">
              <h3 className="text-lg font-semibold">Restart the Python environment</h3>
              <p className="text-sm text-muted-foreground">{restartReason || "Installed packages changed. Restart the backend before running a pipeline."}</p>
              {restartError && <p role="alert" className="text-destructive">{restartError}</p>}
              <Button disabled={restarting} onClick={async () => {
                setRestarting(true); setRestartError(null);
                try { await restartChangedPythonRuntime(); }
                catch (error) { setRestartError(error instanceof Error ? error.message : "Restart failed"); }
                finally { setRestarting(false); }
              }}>{restarting ? "Restarting…" : "Restart backend"}</Button>
            </div>
          ) : mlLoading ? (
            <>
              <Loader2 className="h-10 w-10 animate-spin text-teal-500" />
              <h3 className="text-lg font-semibold">
                {dependencyInstalling ? "Installing dependencies…" : t("ml.loading.title", "Loading ML Engine...")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t(
                  "ml.loading.description",
                  "Machine learning dependencies are being initialized. This page will be available in a moment."
                )}
              </p>
            </>
          ) : mlError ? (
            <>
              <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center">
                <span className="text-destructive text-xl font-bold">!</span>
              </div>
              <h3 className="text-lg font-semibold text-destructive">
                {t("ml.error.title", "ML Engine Error")}
              </h3>
              <p className="text-sm text-muted-foreground">{mlError}</p>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
