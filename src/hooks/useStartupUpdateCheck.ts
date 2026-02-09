/**
 * Startup update check hook.
 *
 * On app mount, checks for available updates (using cached status)
 * and shows a toast notification if any are available.
 * Respects the auto_check setting.
 */

import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useUpdateStatus, useUpdateSettings } from "./useUpdates";

export function useStartupUpdateCheck() {
  const { data: status } = useUpdateStatus();
  const { data: settings } = useUpdateSettings();
  const navigate = useNavigate();
  const hasNotified = useRef(false);

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
}
