import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowRight, Loader2, RefreshCw } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { usePythonEnv } from "@/context/usePythonEnv";

const PYTHON_SETTINGS_PATH = "/settings?tab=python";

/**
 * Non-blocking notice for a Python environment Studio cannot use, and a
 * lighter reminder when the user chose to continue without Python.
 */
export function PythonEnvBanner() {
  const { t } = useTranslation();
  const { pathname, search } = useLocation();
  const { state, setupSkipped, run } = usePythonEnv();
  const [retrying, setRetrying] = useState(false);

  // The Python page already shows the same status with its own actions.
  const onPythonPage = pathname === "/setup"
    || (pathname === "/settings" && new URLSearchParams(search).get("tab") === "python");
  if (!state || onPythonPage) return null;

  if (state.phase === "unconfigured" && setupSkipped) {
    return (
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-muted/50 px-4 py-2 text-sm md:px-6">
        <p className="min-w-0 text-muted-foreground">{t("pythonEnv.banner.skipped")}</p>
        <Button asChild size="sm" variant="outline" className="shrink-0">
          <Link to="/setup">
            {t("pythonEnv.banner.setUp")}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>
    );
  }

  if (state.phase !== "needs_attention") return null;

  const retry = () => {
    setRetrying(true);
    // The outcome is the next state: ready, or the problem shown here.
    run((api) => api.retry())
      .catch((error: unknown) => {
        console.warn("[PythonEnvBanner] Retry failed:", error);
      })
      .finally(() => setRetrying(false));
  };

  return (
    <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/30 md:px-6">
      <Alert className="mx-auto max-w-7xl border-amber-300 bg-background/80 text-amber-950 dark:border-amber-900 dark:text-amber-100">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <AlertTitle>{t(`pythonEnv.problem.${state.problem?.code ?? "unknown"}`)}</AlertTitle>
            {state.problem?.message && (
              <AlertDescription className="mt-1 break-words">{state.problem.message}</AlertDescription>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button type="button" size="sm" variant="outline" disabled={retrying} onClick={retry}>
              {retrying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              {t("common.retry")}
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to={PYTHON_SETTINGS_PATH}>
                {t("pythonEnv.banner.openSettings")}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </Alert>
    </div>
  );
}
