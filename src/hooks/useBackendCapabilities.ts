import { useEffect, useState } from "react";
import { api } from "@/api/transport";
import type { CapabilityLevel } from "@/lib/operatorCapability";

/**
 * Backend capability probes derived from `GET /system/capabilities`.
 *
 * Used to hide UI for optional backend dependencies that are intentionally
 * absent in a pure-sklearn ("lite") build: deep-learning pipeline nodes
 * (PyTorch / TensorFlow / JAX) and the SHAP explainability UI. The endpoint
 * is fetched once per backend start and the result is shared across callers:
 * a restarted backend (for instance after packages were installed in the
 * Python environment) is probed again. Every capability defaults to `true` while the probe is in flight so
 * nothing is hidden prematurely. When the probe fails or times out the optional
 * heavy capabilities are reported unavailable (a deep-learning node offered on
 * a backend without PyTorch cannot run), and the failure is not cached so the
 * next caller probes again.
 *
 * Note: `/system/operator-availability` is NOT a usable signal here — it
 * treats operators whose optional dependency is missing as
 * valid-but-uninstalled and does not flag them, so it never reports DL
 * operators as unavailable.
 */
interface CapabilityFlags {
  deepLearning: boolean;
  report: BackendCapabilityStatus[];
  shap: boolean;
}

type BooleanCapabilityKey = "deepLearning" | "shap";

export interface BackendCapabilityStatus {
  available: boolean;
  id: "torch" | "tensorflow" | "jax" | "shap" | string;
  level: CapabilityLevel;
}

let cached: CapabilityFlags | null = null;
let inflight: Promise<CapabilityFlags> | null = null;

function buildBackendCapabilityStatus(id: BackendCapabilityStatus["id"], available: boolean): BackendCapabilityStatus {
  return {
    available,
    id,
    level: available ? "execute_local" : "metadata",
  };
}

function buildCapabilityFlags(caps: Record<string, boolean>): CapabilityFlags {
  const report = [
    buildBackendCapabilityStatus("torch", Boolean(caps.torch)),
    buildBackendCapabilityStatus("tensorflow", Boolean(caps.tensorflow)),
    buildBackendCapabilityStatus("jax", Boolean(caps.jax)),
    buildBackendCapabilityStatus("shap", Boolean(caps.shap)),
  ];

  return {
    deepLearning: report.some((entry) => ["torch", "tensorflow", "jax"].includes(entry.id) && entry.available),
    report,
    shap: Boolean(caps.shap),
  };
}

function probeCapabilities(): Promise<CapabilityFlags> {
  if (inflight) {
    return inflight;
  }
  inflight = api
    .get<{ capabilities?: Record<string, boolean> }>("/system/capabilities")
    .then((res) => {
      const caps = res?.capabilities ?? {};
      cached = buildCapabilityFlags(caps);
      return cached;
    })
    .catch(() => {
      // Backend unreachable / probe failed: optional heavy capabilities are unproven, so
      // report them unavailable, but leave the cache empty so a later caller can retry.
      inflight = null;
      return buildCapabilityFlags({});
    });
  return inflight;
}

let restartSeen: Event | null = null;

/** Delivers the flags now and again after each backend restart; returns the cleanup. */
function watchCapabilities(onFlags: (flags: CapabilityFlags) => void): () => void {
  let cancelled = false;
  const deliver = (flags: CapabilityFlags) => {
    if (!cancelled) {
      onFlags(flags);
    }
  };
  if (cached !== null) {
    onFlags(cached);
  } else {
    void probeCapabilities().then(deliver);
  }
  const refresh = (event: Event) => {
    // Every mounted caller receives the same event: drop the cache once, share one probe.
    if (restartSeen !== event) {
      restartSeen = event;
      cached = null;
      inflight = null;
    }
    void probeCapabilities().then(deliver);
  };
  window.addEventListener("backend-restarted", refresh);
  return () => {
    cancelled = true;
    window.removeEventListener("backend-restarted", refresh);
  };
}

function useCapability(key: BooleanCapabilityKey): boolean {
  const [available, setAvailable] = useState<boolean>(cached?.[key] ?? true);

  useEffect(() => watchCapabilities((flags) => setAvailable(flags[key])), [key]);

  return available;
}

/**
 * Whether a deep-learning framework (PyTorch / TensorFlow / JAX) is installed
 * in the running backend. Hides deep-learning pipeline nodes when absent.
 */
export function useDeepLearningAvailable(): boolean {
  return useCapability("deepLearning");
}

/**
 * Whether the running backend advertises the optional Python SHAP package.
 */
export function useShapAvailable(): boolean {
  return useCapability("shap");
}

/**
 * Multi-level backend capability report for future method/backend/compute
 * selection surfaces. Existing boolean hooks remain compatibility facades.
 */
export function useBackendCapabilityReport(): BackendCapabilityStatus[] {
  const [report, setReport] = useState<BackendCapabilityStatus[]>(cached?.report ?? []);

  useEffect(() => watchCapabilities((flags) => setReport(flags.report)), []);

  return report;
}
