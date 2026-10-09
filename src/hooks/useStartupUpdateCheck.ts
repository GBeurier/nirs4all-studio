/**
 * Startup update check hook.
 *
 * On app mount:
 * 1. Checks if first-launch setup is needed (redirects to /setup)
 * 2. Checks for available updates and shows toast notification
 * 3. Checks for config drift and shows settings badge
 *
 * Respects the auto_check setting.
 */

import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import i18n from "i18next";
import { useUpdateStatus, useUpdateSettings } from "./useUpdates";
import { useSetupStatus, useIsConfigAligned } from "./useRecommendedConfig";
import { api } from "@/api/transport";
import { getElectronApi } from "@/components/settings/PythonEnvPickerRuntime";
import { useNetworkState } from "./useNetworkState";

export function useStartupUpdateCheck() {
  const { online, isLoading: networkLoading } = useNetworkState();
  const { data: status } = useUpdateStatus();
  const { data: settings } = useUpdateSettings();
  const { data: setupStatus } = useSetupStatus();
  const { isAligned, misalignedCount } = useIsConfigAligned();
  const navigate = useNavigate();
  const hasNotified = useRef(false);
  const hasCheckedSetup = useRef(false);

  // Check for first-launch setup
  useEffect(() => {
    if (hasCheckedSetup.current) return;
    if (!setupStatus) return;

    const desktop = getElectronApi();
    if (!desktop) {
      hasCheckedSetup.current = true;
      if (!setupStatus.setup_completed) navigate("/setup", { replace: true });
      return;
    }
    let cancelled = false;
    void Promise.all([
      desktop.getEnvInfo(),
      api.get<{ ml_ready?: boolean }>("/system/readiness").catch(() => null),
    ]).then(([environment, readiness]) => {
      if (cancelled) return;
      hasCheckedSetup.current = true;
      if (!cancelled && !environment.setupDeferred && (!setupStatus.setup_completed || readiness?.ml_ready !== true)) {
        navigate("/setup", { replace: true });
      }
    }).catch(() => { if (!cancelled) navigate("/setup", { replace: true }); });
    return () => { cancelled = true; };
  }, [setupStatus, navigate]);

  // Check for updates
  useEffect(() => {
    if (hasNotified.current) return;
    if (networkLoading || !online) return;
    if (!status || !settings) return;
    if (!settings.auto_check) return;

    const hasWebapp = status.webapp?.update_available ?? false;
    const hasNirs4all = !getElectronApi() && (status.nirs4all?.update_available ?? false);

    if (!hasWebapp && !hasNirs4all) return;

    hasNotified.current = true;

    const parts: string[] = [];
    if (hasWebapp && status.webapp?.latest_version) {
      parts.push(`Webapp ${status.webapp.latest_version}`);
    }
    if (hasNirs4all && status.nirs4all?.latest_version) {
      parts.push(`nirs4all ${status.nirs4all.latest_version}`);
    }

    toast(i18n.t("common.updates.available.title"), {
      description: i18n.t("common.updates.available.description", { versions: parts.join(", ") }),
      duration: 8000,
      action: {
        label: i18n.t("common.updates.available.view"),
        onClick: () => navigate("/settings?tab=updates"),
      },
    });
  }, [online, networkLoading, status, settings, navigate]);

  // User-selected desktop packages are informational, not a scored profile.
  useEffect(() => {
    if (getElectronApi()) return;
    if (networkLoading || !online) return;
    if (!setupStatus?.setup_completed) return;
    if (isAligned) return;
    if (misalignedCount === 0) return;

    toast(i18n.t("common.updates.drift.title"), {
      description: i18n.t("common.updates.drift.description", { count: misalignedCount }),
      duration: 6000,
      action: {
        label: i18n.t("common.updates.drift.review"),
        onClick: () => navigate("/settings?tab=advanced"),
      },
    });
  }, [online, networkLoading, isAligned, misalignedCount, setupStatus, navigate]);
}
