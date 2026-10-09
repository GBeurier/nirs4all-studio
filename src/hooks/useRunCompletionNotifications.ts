import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useActiveRuns } from "@/context/useActiveRuns";

/** The execution layer reports a user-initiated stop as a failure with this message. */
const CANCELLED_MESSAGE = "Cancelled";

function isAppInBackground(): boolean {
  return document.hidden || !document.hasFocus();
}

/**
 * Announces run completion/failure from anywhere in the app: a toast with a
 * "View run" action, plus a desktop notification when the window is hidden or
 * unfocused. Each run is announced once. Failures already open a dialog from
 * `ActiveRunProvider`, so they only produce the desktop notification.
 */
export function useRunCompletionNotifications(): void {
  const { activeRuns, getRunProgress } = useActiveRuns();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const trackedRuns = useRef(new Map<string, string>());
  const announcedRuns = useRef(new Set<string>());

  useEffect(() => {
    const currentIds = new Set(activeRuns.map((run) => run.runId));
    for (const run of activeRuns) trackedRuns.current.set(run.runId, run.runName);

    for (const [runId, trackedName] of trackedRuns.current) {
      if (currentIds.has(runId)) continue;
      const finalState = getRunProgress(runId);
      if (!finalState) {
        trackedRuns.current.delete(runId);
        continue;
      }
      if (finalState.status !== "completed" && finalState.status !== "failed") continue;
      trackedRuns.current.delete(runId);
      if (announcedRuns.current.has(runId)) continue;
      announcedRuns.current.add(runId);
      if (finalState.status === "failed" && finalState.message === CANCELLED_MESSAGE) continue;

      const runName = finalState.runName || trackedName;
      const runPath = `/runs/${encodeURIComponent(runId)}`;
      const failed = finalState.status === "failed";
      const title = t(failed ? "runs.notifications.failed" : "runs.notifications.completed", { name: runName });
      const openRun = () => navigate(runPath);

      if (!failed && pathname !== runPath) {
        toast.success(title, { action: { label: t("runs.notifications.viewRun"), onClick: openRun } });
      }
      if (isAppInBackground() && typeof Notification !== "undefined" && Notification.permission === "granted") {
        const notification = new Notification(title, { tag: `run-${runId}` });
        notification.onclick = () => {
          window.focus();
          openRun();
        };
      }
    }
  }, [activeRuns, getRunProgress, navigate, pathname, t]);
}
