/**
 * System information & diagnostics API client functions.
 */

import { api } from "./http";

// ============= Phase 5: System Information & Diagnostics =============

import type {
  SystemInfoResponse,
  SystemCapabilitiesResponse,
  HealthCheckResponse,
  HealthCheckWithLatency,
  SystemStatusResponse,
  SystemPathsResponse,
  ErrorLogResponse,
} from "@/types/settings";

/**
 * Get system and environment information
 */
export async function getSystemInfo(): Promise<SystemInfoResponse> {
  return api.get("/system/info");
}

/**
 * Get system capabilities based on installed packages
 */
export async function getSystemCapabilities(): Promise<SystemCapabilitiesResponse> {
  return api.get("/system/capabilities");
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
