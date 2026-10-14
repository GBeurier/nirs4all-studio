import { useEffect, useState } from "react";

/** Display the product service address and refresh it after runtime switches. */
export function useBackendDisplayUrl(unavailableLabel: string): string {
  const [url, setUrl] = useState(unavailableLabel);
  useEffect(() => {
    let cancelled = false;
    let revision = 0;
    const refresh = async () => {
      const current = ++revision;
      const desktop = window.electronApi?.isElectron || window.location.protocol === "file:";
      let resolved = desktop ? unavailableLabel : window.location.origin;
      if (desktop) {
        try {
          const info = await window.electronApi?.getNativeSidecarInfo();
          if (info?.status === "running" && info.url) resolved = info.url;
        } catch { /* Keep the unavailable label until the next restart. */ }
      }
      if (!cancelled && current === revision) setUrl(resolved);
    };
    void refresh();
    window.addEventListener("backend-restarted", refresh);
    return () => { cancelled = true; window.removeEventListener("backend-restarted", refresh); };
  }, [unavailableLabel]);
  return url;
}
