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
import { useUpdateStatus, useUpdateSettings } from "./useUpdates";
import { useSetupStatus, useIsConfigAligned } from "./useRecommendedConfig";

export function useStartupUpdateCheck() {
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

    hasCheckedSetup.current = true;

    if (!setupStatus.setup_completed) {
      navigate("/setup", { replace: true });
    }
  }, [setupStatus, navigate]);

  // Check for updates
  useEffect(() => {
    if (hasNotified.current) return;
    if (!status || !settings) return;
    if (!settings.auto_check) return;

    const hasWebapp = status.webapp?.update_available ?? false;
    const hasNirs4all = status.nirs4all?.update_available ?? false;

    if (!hasWebapp && !hasNirs4all) return;

    hasNotified.current = true;

    const parts: string[] = [];
    if (hasWebapp && status.webapp?.latest_version) {
      parts.push(`Webapp ${status.webapp.latest_version}`);
    }
    if (hasNirs4all && status.nirs4all?.latest_version) {
      parts.push(`nirs4all ${status.nirs4all.latest_version}`);
    }

    toast("Updates available", {
      description: `New versions: ${parts.join(", ")}`,
      duration: 8000,
      action: {
        label: "View",
        onClick: () => navigate("/settings?tab=advanced"),
      },
    });
  }, [status, settings, navigate]);

  // Config drift notification
  useEffect(() => {
    if (!setupStatus?.setup_completed) return;
    if (isAligned) return;
    if (misalignedCount === 0) return;

    toast("Configuration drift detected", {
      description: `${misalignedCount} package${misalignedCount > 1 ? "s" : ""} differ from recommended config`,
      duration: 6000,
      action: {
        label: "Review",
        onClick: () => navigate("/settings?tab=advanced"),
      },
    });
  }, [isAligned, misalignedCount, setupStatus, navigate]);
}
