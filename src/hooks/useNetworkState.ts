/**
 * Network state hook — combines two signals:
 *
 * 1. ``navigator.onLine`` (OS-level) — reliable browser API tracking actual
 *    network interface state. This is the primary signal: if the OS says we're
 *    offline, we are; if it says online, we trust it.
 * 2. Backend ``/api/system/network`` — reports user/env-level overrides
 *    (``NIRS4ALL_OFFLINE`` env var or offline_mode="on" setting).
 *
 * We deliberately do NOT ping any external host as a probe: HEAD requests to
 * public services are routinely blocked by corporate firewalls/proxies even
 * when the user has full internet access. That produced false "offline" badges.
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getNetworkState, type NetworkState } from "@/api/client";

export const networkKeys = {
  all: ["network"] as const,
  state: () => [...networkKeys.all, "state"] as const,
};

function getNavigatorOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

export function useNetworkState() {
  const [navOnline, setNavOnline] = useState<boolean>(getNavigatorOnline());

  useEffect(() => {
    const update = () => setNavOnline(getNavigatorOnline());
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const query = useQuery<NetworkState>({
    queryKey: networkKeys.state(),
    queryFn: getNetworkState,
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
    networkMode: "always",
  });

  const forced = query.data?.forced ?? false;
  // Offline if EITHER the OS reports no interface OR the user/env forced offline.
  const online = navOnline && !forced;

  return {
    online,
    forced,
    navOnline,
    mode: query.data?.mode ?? "auto",
    isLoading: query.isLoading,
    raw: query.data,
  };
}
