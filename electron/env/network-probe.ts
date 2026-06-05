/**
 * Network reachability probe shared with backend network_state.py.
 *
 * Races several diversified provider URLs in parallel — first response wins —
 * so a single blocked host (corporate proxy, GeoDNS) does not flip the app
 * offline. The result is cached for a short TTL and concurrent callers share a
 * single in-flight probe.
 */

import https from "node:https";

const NETWORK_PROBE_URLS = [
  "https://www.cloudflare.com",
  "https://pypi.org",
  "https://api.github.com",
  "https://www.google.com",
];
const NETWORK_PROBE_TIMEOUT_MS = 4_000;
const NETWORK_PROBE_TTL_MS = 60_000;

let networkProbeCache: { at: number; online: boolean } | null = null;
let networkProbeInFlight: Promise<boolean> | null = null;

function isOfflineForced(): boolean {
  const v = (process.env.NIRS4ALL_OFFLINE || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function probeOne(url: string, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve(result);
    };
    const t = setTimeout(() => done(false), timeoutMs + 250);
    try {
      const req = https.request(
        url,
        { method: "HEAD", timeout: timeoutMs },
        (res) => {
          // Any HTTP response (incl. 4xx redirect) means we reached the server.
          done((res.statusCode ?? 0) < 600);
          res.resume();
        },
      );
      req.on("error", () => done(false));
      req.on("timeout", () => { req.destroy(); done(false); });
      req.end();
    } catch {
      done(false);
    }
  });
}

/**
 * Probe network reachability. Races multiple URLs and caches the result
 * for 60 s. Returns `false` whenever `NIRS4ALL_OFFLINE` is set, without
 * attempting any outbound connection. Never throws. Concurrent callers
 * share the same in-flight probe.
 */
export async function probeNetworkOnline(): Promise<boolean> {
  if (isOfflineForced()) return false;
  const now = Date.now();
  if (networkProbeCache && now - networkProbeCache.at < NETWORK_PROBE_TTL_MS) {
    return networkProbeCache.online;
  }
  if (networkProbeInFlight) return networkProbeInFlight;

  networkProbeInFlight = (async () => {
    try {
      const online = await new Promise<boolean>((resolve) => {
        let resolved = false;
        const finish = (v: boolean) => {
          if (resolved) return;
          resolved = true;
          resolve(v);
        };
        let pending = NETWORK_PROBE_URLS.length;
        for (const url of NETWORK_PROBE_URLS) {
          probeOne(url, NETWORK_PROBE_TIMEOUT_MS).then((ok) => {
            if (ok) finish(true);
            pending -= 1;
            if (pending === 0) finish(false);
          });
        }
      });
      networkProbeCache = { at: Date.now(), online };
      console.log(`[EnvManager] Network probe: ${online ? "ONLINE" : "OFFLINE"}`);
      return online;
    } finally {
      networkProbeInFlight = null;
    }
  })();

  return networkProbeInFlight;
}
