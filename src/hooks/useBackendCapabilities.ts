import { useEffect, useState } from "react";
import { api } from "@/api/transport";

/**
 * Backend capability probes derived from `GET /system/capabilities`.
 *
 * Used to hide UI for optional backend dependencies that are intentionally
 * absent in a pure-sklearn ("lite") build: deep-learning pipeline nodes
 * (PyTorch / TensorFlow / JAX) and the SHAP explainability UI. The endpoint
 * is fetched at most once per session and the result is shared across
 * callers. Every capability defaults to `true` until known (and on any probe
 * failure) so nothing is hidden prematurely or when the backend is
 * unreachable — only an explicit "not installed" answer hides a feature.
 *
 * Note: `/system/operator-availability` is NOT a usable signal here — it
 * treats operators whose optional dependency is missing as
 * valid-but-uninstalled and does not flag them, so it never reports DL
 * operators as unavailable.
 */
interface CapabilityFlags {
  deepLearning: boolean;
  shap: boolean;
}

let cached: CapabilityFlags | null = null;
let inflight: Promise<CapabilityFlags> | null = null;

function probeCapabilities(): Promise<CapabilityFlags> {
  if (inflight) {
    return inflight;
  }
  inflight = api
    .get<{ capabilities?: Record<string, boolean> }>("/system/capabilities")
    .then((res) => {
      const caps = res?.capabilities ?? {};
      cached = {
        deepLearning: Boolean(caps.torch || caps.tensorflow || caps.jax),
        shap: Boolean(caps.shap),
      };
      return cached;
    })
    .catch(() => {
      // Backend unreachable / probe failed — assume available so nothing is hidden.
      cached = { deepLearning: true, shap: true };
      return cached;
    });
  return inflight;
}

function useCapability(key: keyof CapabilityFlags): boolean {
  const [available, setAvailable] = useState<boolean>(cached?.[key] ?? true);

  useEffect(() => {
    if (cached !== null) {
      setAvailable(cached[key]);
      return;
    }
    let cancelled = false;
    probeCapabilities().then((flags) => {
      if (!cancelled) {
        setAvailable(flags[key]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

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
 * Whether `shap` is installed in the running backend. Hides the SHAP /
 * explainability UI (the Lab "Shapley" tab and the `/lab/shapley` route)
 * when absent.
 */
export function useShapAvailable(): boolean {
  return useCapability("shap");
}
