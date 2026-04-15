import { WifiOff } from "lucide-react";
import { useNetworkState } from "@/hooks/useNetworkState";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Subtle offline indicator — renders nothing when online.
 * Shown in the header area so users know update checks are disabled
 * without intrusive banners.
 */
export function OfflineIndicator() {
  const { online, forced, navOnline, mode } = useNetworkState();
  if (online) return null;

  const label = forced
    ? mode === "on"
      ? "Offline mode (forced by user setting)"
      : "Offline mode (--offline flag)"
    : !navOnline
    ? "No network interface available — update checks are disabled"
    : "Offline";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="status"
          aria-label="Offline"
          className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Offline</span>
        </div>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
