/**
 * Startup checks.
 *
 * On app mount:
 * 1. Opens the Python setup page while no environment is selected (desktop only)
 * 2. Warns once when recommended Python packages are older than recommended
 * 3. Checks for an application update and shows a toast notification
 *
 * The update toast respects the auto_check setting.
 */

import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import i18n from "i18next";
import { useUpdateStatus, useUpdateSettings } from "./useUpdates";
import { useNetworkState } from "./useNetworkState";
import { usePythonEnv } from "@/context/usePythonEnv";

export function useStartupUpdateCheck() {
  const { online, isLoading: networkLoading } = useNetworkState();
  const { data: status } = useUpdateStatus();
  const { data: settings } = useUpdateSettings();
  const { state: pythonEnv, setupSkipped } = usePythonEnv();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const hasNotified = useRef(false);
  const hasWarnedOutdated = useRef(false);

  // Studio needs an environment: stay on setup until one is selected or the
  // user continues without Python. Outside Electron the state is never set.
  const needsSetup = pythonEnv?.phase === "unconfigured" && !setupSkipped;
  useEffect(() => {
    if (needsSetup && pathname !== "/setup") navigate("/setup", { replace: true });
  }, [needsSetup, pathname, navigate]);

  const outdatedCount = pythonEnv?.phase === "ready" ? pythonEnv.selected?.outdatedRecommendedCount ?? 0 : 0;
  useEffect(() => {
    if (hasWarnedOutdated.current || outdatedCount === 0) return;
    hasWarnedOutdated.current = true;
    toast(i18n.t("pythonEnv.outdatedToast.title"), {
      description: i18n.t("pythonEnv.outdated", { count: outdatedCount }),
      duration: 8000,
      action: {
        label: i18n.t("pythonEnv.outdatedToast.review"),
        onClick: () => navigate("/settings?tab=python"),
      },
    });
  }, [outdatedCount, navigate]);

  // Check for an application update
  useEffect(() => {
    if (hasNotified.current) return;
    if (networkLoading || !online) return;
    if (!status || !settings) return;
    if (!settings.auto_check) return;
    if (!status.webapp?.update_available) return;

    hasNotified.current = true;

    toast(i18n.t("common.updates.available.title"), {
      description: i18n.t("common.updates.available.description", {
        versions: status.webapp.latest_version ? `Webapp ${status.webapp.latest_version}` : "",
      }),
      duration: 8000,
      action: {
        label: i18n.t("common.updates.available.view"),
        onClick: () => navigate("/settings?tab=updates"),
      },
    });
  }, [online, networkLoading, status, settings, navigate]);
}
