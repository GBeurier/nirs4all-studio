import { useEffect, useState } from "react";

import { getElapsedSeconds } from "@/lib/runs/format";

/**
 * Seconds elapsed since `startedAt`, re-evaluated once per second.
 *
 * The interval only exists while `enabled` is true and a start timestamp is known;
 * otherwise nothing is scheduled and the result is null.
 */
export function useElapsedSeconds(startedAt: string | undefined, enabled: boolean): number | null {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const isTicking = enabled && Boolean(startedAt);

  useEffect(() => {
    if (!isTicking) return;

    setNowMs(Date.now());
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [isTicking]);

  return isTicking ? getElapsedSeconds(startedAt, nowMs) : null;
}
