/**
 * System API client — environment info, capabilities, status/paths, health
 * checks, error logs, operator availability, build info, network state, and
 * opening folders in the OS file explorer.
 */

import { api } from "./transport";
import type {
  SystemInfoResponse,
  SystemCapabilitiesResponse,
  HealthCheckResponse,
  HealthCheckWithLatency,
  SystemStatusResponse,
  SystemPathsResponse,
  ErrorLogResponse,
  RuntimeSummaryResponse,
} from "@/types/settings";
import type { OperatorCapabilityEntry } from "@/lib/operatorCapability";

/**
 * Get system and environment information
 */
export async function getSystemInfo(): Promise<SystemInfoResponse> {
  return api.get("/system/info");
}

/**
 * Get the configured-vs-running Python runtime summary.
 */
export async function getRuntimeSummary(): Promise<RuntimeSummaryResponse> {
  return api.get("/system/env-coherence");
}

/**
 * Get system capabilities based on installed packages
 */
export async function getSystemCapabilities(): Promise<SystemCapabilitiesResponse> {
  return api.get("/system/capabilities");
}

export interface OperatorAvailabilityEntry {
  id: string;
  name: string;
  type: string;
  class_path?: string | null;
  function_path?: string | null;
  capability_level?: OperatorCapabilityEntry["level"];
  backend?: string | null;
  implementation_ref?: string | null;
  compute?: string[];
  available?: boolean;
  reason?: string | null;
  error?: string | null;
}

export interface OperatorAvailabilityResponse {
  registry_version?: string;
  generated_at?: string;
  computed_at: string;
  checked_count: number;
  capabilities?: OperatorCapabilityEntry[];
  unavailable: OperatorAvailabilityEntry[];
}

export async function getOperatorAvailability(): Promise<OperatorAvailabilityResponse> {
  return api.get("/system/operator-availability");
}

/**
 * Get current system status including workspace info
 */
export async function getSystemStatus(): Promise<SystemStatusResponse> {
  return api.get("/system/status");
}

/**
 * Get important system paths
 */
export async function getSystemPaths(): Promise<SystemPathsResponse> {
  return api.get("/system/paths");
}

/**
 * Perform a health check with latency measurement
 */
export async function performHealthCheck(): Promise<HealthCheckWithLatency> {
  const startTime = performance.now();
  const response = await api.get<HealthCheckResponse>("/health");
  const endTime = performance.now();

  return {
    ...response,
    latency_ms: Math.round(endTime - startTime),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get recent error logs (stored in backend memory)
 */
export async function getErrorLogs(limit: number = 50): Promise<ErrorLogResponse> {
  return api.get(`/system/errors?limit=${limit}`);
}

/**
 * Clear error logs
 */
export async function clearErrorLogs(): Promise<{ success: boolean; cleared: number }> {
  return api.delete("/system/errors");
}

/**
 * Open a folder in the system file explorer.
 * Uses Electron shell API in desktop mode, backend endpoint in web mode.
 */
export async function openFolderInExplorer(path: string): Promise<void> {
  if (window.electronApi?.revealInExplorer) {
    await window.electronApi.revealInExplorer(path);
  } else {
    await api.post("/system/open-folder", { path });
  }
}

// Build info (includes standalone/frozen detection)
export interface BuildInfoResponse {
  build: { flavor: string; gpu_enabled: boolean };
  gpu: Record<string, unknown>;
  runtime_mode: "development" | "managed" | "bundled" | "pyinstaller";
  is_frozen: boolean;
  summary: {
    flavor: string;
    gpu_build: boolean;
    gpu_available: boolean;
    gpu_type: string | null;
    gpu_device: string | null;
    runtime_mode: "development" | "managed" | "bundled" | "pyinstaller";
  };
}

export async function getBuildInfo(): Promise<BuildInfoResponse> {
  return api.get("/system/build");
}

export interface NetworkState {
  online: boolean;
  forced: boolean;
  mode: "auto" | "on" | "off";
  env_forced: boolean;
  probe_age_s: number | null;
}

/**
 * Get current network reachability state from the backend.
 */
export async function getNetworkState(): Promise<NetworkState> {
  return api.get("/system/network");
}
