import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowRight } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getElectronApi } from "@/components/settings/PythonEnvPickerRuntime";
import { useMlReadiness } from "@/context/useMlReadiness";
import { buildPythonRuntimeNotice } from "@/lib/pythonRuntimeNotice";
import type { DesktopEnvInfo } from "@/types/pythonRuntime";

/** Non-blocking desktop notice for a replaced or unusable Python environment. */
export function PythonRuntimeNoticeBanner() {
  const { t } = useTranslation();
  const { controlReady, mlReady, mlLoading, mlError } = useMlReadiness();
  const [envInfo, setEnvInfo] = useState<DesktopEnvInfo | null>(null);

  const refresh = useCallback(() => {
    const desktop = getElectronApi();
    if (!desktop) return;
    desktop.getEnvInfo().then(setEnvInfo).catch((error: unknown) => {
      console.warn("[PythonRuntimeNoticeBanner] Could not read the Python environment:", error);
    });
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener("backend-restarted", refresh);
    return () => window.removeEventListener("backend-restarted", refresh);
  }, [refresh]);

  const notice = buildPythonRuntimeNotice(envInfo, { controlReady, mlReady, mlLoading, mlError }, t);
  if (!notice) return null;

  return (
    <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/30 md:px-6">
      <Alert className="mx-auto max-w-7xl border-amber-300 bg-background/80 text-amber-950 dark:border-amber-900 dark:text-amber-100">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <AlertTitle>{notice.title}</AlertTitle>
            <AlertDescription className="mt-1 break-words">{notice.message}</AlertDescription>
          </div>
          <Button asChild size="sm" variant="outline" className="shrink-0">
            <Link to="/settings?tab=advanced">
              {t("layout.pythonRuntime.review")}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </Alert>
    </div>
  );
}
