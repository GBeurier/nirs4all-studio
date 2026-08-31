/**
 * Transport core for nirs4all backend communication.
 *
 * Owns base-URL resolution (Electron dynamic port / Vite proxy), the shared
 * fetch wrapper with transient-network retry, a single error-parsing contract,
 * JSON + MessagePack handling, AbortSignal pass-through, and binary downloads.
 * Per-domain modules import `api` / `requestBinary` from here; they never call
 * `fetch` directly.
 */

import { createLogger } from "@/lib/logger";

const logger = createLogger("API");

// Default API base URL for web mode (uses Vite proxy)
const DEFAULT_API_BASE_URL = "/api";

// Cache for the resolved backend URL in Electron mode
let resolvedBackendUrl: string | null = null;
let backendUrlPromise: Promise<string> | null = null;
const NATIVE_SIDECAR_PYTHON_PLUGIN_ENDPOINTS = new Set([
  "/system/capabilities",
  "/system/info",
  "/system/build",
  "/system/env-coherence",
]);
const NATIVE_SIDECAR_STATE_ENDPOINTS = new Set([
  "/app/settings",
  "/app/favorites",
  "/app/config-path",
  "/workspaces",
  "/system/network",
]);
const NATIVE_SIDECAR_WORKSPACE_STATE_ENDPOINT = /^\/workspaces\/[^/?]+(?:\/(activate))?$/;

type ElectronBackendStatus =
  | "stopped"
  | "starting"
  | "running"
  | "error"
  | "restarting"
  | "setup_required";
type NativeSidecarStatus =
  "disabled" | "starting" | "running" | "stopped" | "error";

interface ElectronBridgeApi {
  isElectron?: boolean;
  getBackendUrl?: () => Promise<string>;
  getBackendInfo?: () => Promise<{
    status: ElectronBackendStatus;
    port: number;
    url: string;
    error?: string;
    restartCount: number;
  }>;
  getNativeSidecarInfo?: () => Promise<{
    status: NativeSidecarStatus;
    url: string | null;
    pythonPluginHostConfigured: boolean;
  }>;
}

type ApiRoute = {
  baseUrl: string;
  source: "backend" | "native-sidecar";
};

/**
 * Detect if we're running in Electron.
 * Uses multiple detection methods since electronApi may not be available immediately.
 */
function isElectronEnvironment(): boolean {
  if (typeof window === "undefined") return false;

  // Check if electronApi is exposed (preferred method)
  if (
    (window as unknown as { electronApi?: ElectronBridgeApi }).electronApi
      ?.isElectron
  ) {
    return true;
  }

  // Check if we're using file:// protocol (fallback for when electronApi isn't ready)
  if (window.location.protocol === "file:") {
    return true;
  }

  return false;
}

/**
 * Wait for electronApi to become available (preload script may take time)
 */
async function waitForElectronApi(maxWaitMs: number = 5000): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    if (
      (window as unknown as { electronApi?: ElectronBridgeApi }).electronApi
        ?.getBackendUrl
    ) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

function getElectronBridge(): ElectronBridgeApi | null {
  if (typeof window === "undefined") {
    return null;
  }
  return (
    (window as unknown as { electronApi?: ElectronBridgeApi }).electronApi ??
    null
  );
}

/**
 * Get the API base URL, resolving Electron backend URL if needed.
 * In Electron mode, this fetches the dynamic port from the main process.
 * In web mode, it returns "/api" (which Vite proxies to the backend).
 */
export async function getApiBaseUrl(): Promise<string> {
  // Return cached URL if available
  if (resolvedBackendUrl !== null) {
    return resolvedBackendUrl;
  }

  // If already resolving, wait for that promise
  if (backendUrlPromise !== null) {
    return backendUrlPromise;
  }

  // Check if we're in Electron mode
  if (isElectronEnvironment()) {
    backendUrlPromise = (async () => {
      try {
        // Wait for electronApi to be available
        const apiAvailable = await waitForElectronApi();
        if (!apiAvailable) {
          logger.error("electronApi not available after waiting");
          throw new Error("electronApi not available");
        }

        const electronApi = (
          window as unknown as {
            electronApi: { getBackendUrl: () => Promise<string> };
          }
        ).electronApi;
        const backendUrl = await electronApi.getBackendUrl();
        resolvedBackendUrl = `${backendUrl}/api`;
        logger.info(`Using Electron backend URL: ${resolvedBackendUrl}`);
        return resolvedBackendUrl;
      } catch (error) {
        logger.error("Failed to get backend URL from Electron:", error);
        // Fallback to default - may not work but provides better error messages
        resolvedBackendUrl = DEFAULT_API_BASE_URL;
        return resolvedBackendUrl;
      }
    })();
    return backendUrlPromise;
  }

  // Web mode - use relative URL (Vite proxy)
  resolvedBackendUrl = DEFAULT_API_BASE_URL;
  return resolvedBackendUrl;
}

/**
 * Reset the cached backend URL so the next API call re-resolves it.
 * Must be called after backend restart (port may change).
 */
export function resetBackendUrl(): void {
  resolvedBackendUrl = null;
  backendUrlPromise = null;
}

async function resolveApiRoute(endpoint: string, method: string): Promise<ApiRoute> {
  if (
    !isNativeSidecarEndpoint(endpoint, method) ||
    !isElectronEnvironment()
  ) {
    return { baseUrl: await getApiBaseUrl(), source: "backend" };
  }
  const sidecar = getElectronBridge()?.getNativeSidecarInfo;
  if (!sidecar) {
    return { baseUrl: await getApiBaseUrl(), source: "backend" };
  }
  try {
    const info = await sidecar();
    if (
      info.status === "running" &&
      info.url &&
      (!requiresPythonPluginHost(endpoint) || info.pythonPluginHostConfigured)
    ) {
      const baseUrl = `${info.url}/api`;
      logger.info(`Using native sidecar route for ${endpoint}: ${baseUrl}`);
      return { baseUrl, source: "native-sidecar" };
    }
    logger.info(`Native sidecar cannot serve ${endpoint} in its current state`);
  } catch (error) {
    logger.warn(`Failed to inspect native sidecar for ${endpoint}`, error);
  }
  return { baseUrl: await getApiBaseUrl(), source: "backend" };
}

function isNativeSidecarEndpoint(endpoint: string, method: string): boolean {
  return (
    NATIVE_SIDECAR_PYTHON_PLUGIN_ENDPOINTS.has(endpoint) ||
    NATIVE_SIDECAR_STATE_ENDPOINTS.has(endpoint) ||
    endpoint.startsWith("/app/favorites/") ||
    isNativeLinkedWorkspaceStateEndpoint(endpoint, method)
  );
}

function isNativeLinkedWorkspaceStateEndpoint(endpoint: string, method: string): boolean {
  const match = NATIVE_SIDECAR_WORKSPACE_STATE_ENDPOINT.exec(endpoint);
  if (!match) return false;
  const normalizedMethod = method.toUpperCase();
  return (
    (normalizedMethod === "DELETE" && match[1] === undefined) ||
    (normalizedMethod === "POST" && match[1] === "activate")
  );
}

function requiresPythonPluginHost(endpoint: string): boolean {
  return NATIVE_SIDECAR_PYTHON_PLUGIN_ENDPOINTS.has(endpoint);
}

export interface ApiError {
  detail: string;
  status: number;
}

export interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
}

type ApiValidationIssue = {
  loc?: unknown[];
  msg?: unknown;
};

function formatValidationPath(loc: unknown[] | undefined): string | null {
  if (!Array.isArray(loc) || loc.length === 0) {
    return null;
  }

  const path = loc
    .filter((part) => part !== "body")
    .map((part) => String(part));

  return path.length > 0 ? path.join(".") : null;
}

function formatValidationIssue(issue: unknown): string | null {
  if (typeof issue === "string" && issue.trim()) {
    return issue;
  }

  if (!issue || typeof issue !== "object") {
    return null;
  }

  const { loc, msg } = issue as ApiValidationIssue;
  const message = typeof msg === "string" && msg.trim() ? msg : null;
  if (!message) {
    return null;
  }

  const path = formatValidationPath(loc);
  return path ? `${path}: ${message}` : message;
}

export function formatApiErrorDetail(detail: unknown, status?: number): string {
  if (typeof detail === "string" && detail.trim()) {
    return detail;
  }

  if (Array.isArray(detail)) {
    const messages = detail
      .map((issue) => formatValidationIssue(issue))
      .filter((message): message is string => Boolean(message));

    if (messages.length > 0) {
      return messages.join("\n");
    }
  }

  if (detail && typeof detail === "object") {
    const message = formatValidationIssue(detail);
    if (message) {
      return message;
    }

    try {
      const serialized = JSON.stringify(detail);
      if (serialized && serialized !== "{}") {
        return serialized;
      }
    } catch {
      // Fall through to generic HTTP fallback below.
    }
  }

  return status ? `HTTP error ${status}` : "Network error";
}

function isApiError(error: unknown): error is ApiError {
  return Boolean(
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number",
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Build an ApiError from a non-ok response body (shared by all request paths).
 */
async function parseResponseError(response: Response): Promise<ApiError> {
  const errorData = await response.json().catch(() => ({}));
  return {
    detail: formatApiErrorDetail(
      errorData.detail ?? errorData,
      response.status,
    ),
    status: response.status,
  };
}

/**
 * Normalize a thrown value into an ApiError, preserving existing ApiErrors and
 * re-throwing AbortErrors so callers can detect cancellation.
 */
function toApiError(error: unknown): ApiError {
  if (isApiError(error) || isAbortError(error)) {
    throw error;
  }
  return {
    detail: error instanceof Error ? error.message : "Network error",
    status: 0,
  };
}

function isRetryableElectronNetworkError(error: unknown): boolean {
  if (!isElectronEnvironment() || isApiError(error) || isAbortError(error)) {
    return false;
  }

  if (error instanceof TypeError) {
    return true;
  }

  if (error instanceof Error) {
    return /failed to fetch|fetch failed|networkerror/i.test(error.message);
  }

  return false;
}

async function waitForElectronBackendToBeReachable(
  maxWaitMs: number = 8000,
): Promise<void> {
  const bridge = getElectronBridge();
  if (!bridge?.getBackendInfo) {
    return;
  }

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const info = await bridge.getBackendInfo();
      if (info.status === "running") {
        return;
      }
      if (
        info.status === "error" ||
        info.status === "setup_required" ||
        info.status === "stopped"
      ) {
        return;
      }
    } catch {
      // Fall through to the next poll interval.
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function prepareElectronBackendRetry(endpoint: string): Promise<void> {
  resetBackendUrl();

  const bridge = getElectronBridge();
  if (!bridge?.getBackendInfo) {
    return;
  }

  try {
    const info = await bridge.getBackendInfo();
    if (info.status === "starting" || info.status === "restarting") {
      logger.warn(
        `[request] waiting for backend ${info.status} before retrying ${endpoint}`,
      );
      await waitForElectronBackendToBeReachable();
    }
  } catch (error) {
    logger.warn(
      `[request] failed to inspect backend status before retrying ${endpoint}`,
      error,
    );
  }
}

async function fetchWithRetry(
  endpoint: string,
  config: RequestInit,
): Promise<Response> {
  let lastError: unknown;
  let route = await resolveApiRoute(endpoint, config.method ?? "GET");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const url = `${route.baseUrl}${endpoint}`;

    try {
      return await fetch(url, config);
    } catch (error) {
      lastError = error;
      if (
        attempt === 0 &&
        route.source === "backend" &&
        isRetryableElectronNetworkError(error)
      ) {
        logger.warn(
          `[request] transient Electron network error for ${endpoint}; retrying once`,
          error,
        );
        await prepareElectronBackendRetry(endpoint);
        route = await resolveApiRoute(endpoint, config.method ?? "GET");
        continue;
      }
      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Network error");
}

class ApiClient {
  private async request<T>(
    endpoint: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const { body, ...restOptions } = options;

    const config: RequestInit = {
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      ...restOptions,
      body: body ? JSON.stringify(body) : undefined,
    };

    try {
      const response = await fetchWithRetry(endpoint, config);

      if (!response.ok) {
        throw await parseResponseError(response);
      }

      return await response.json();
    } catch (error) {
      throw toApiError(error);
    }
  }

  // GET request
  async get<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { method: "GET", ...options });
  }

  // POST request
  async post<T>(
    endpoint: string,
    data?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    return this.request<T>(endpoint, {
      method: "POST",
      body: data,
      ...options,
    });
  }

  // PUT request
  async put<T>(
    endpoint: string,
    data?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    return this.request<T>(endpoint, { method: "PUT", body: data, ...options });
  }

  // DELETE request
  async delete<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { method: "DELETE", ...options });
  }

  // POST with MessagePack content negotiation (binary response when backend supports it)
  async postMsgpack<T>(
    endpoint: string,
    data?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    const { body: _ignored, ...restOptions } = options || {};

    const config: RequestInit = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/x-msgpack, application/json;q=0.9",
        ...options?.headers,
      },
      ...restOptions,
      body: data ? JSON.stringify(data) : undefined,
    };

    try {
      const response = await fetchWithRetry(endpoint, config);

      if (!response.ok) {
        const error = await parseResponseError(response);
        logger.error(
          `[postMsgpack] ${response.status} ${endpoint}:`,
          error.detail,
        );
        throw error;
      }

      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/x-msgpack")) {
        const { decode } = await import("@msgpack/msgpack");
        const buffer = await response.arrayBuffer();
        return decode(new Uint8Array(buffer)) as T;
      }

      return await response.json();
    } catch (error) {
      throw toApiError(error);
    }
  }
}

export const api = new ApiClient();

/**
 * POST a FormData body (e.g. file uploads) and parse a JSON response.
 * Routes through the shared fetch wrapper for the Electron transient-network
 * retry and the single error contract, and accepts an optional AbortSignal.
 * The browser sets the multipart Content-Type/boundary, so none is supplied.
 */
export async function requestForm<T>(
  endpoint: string,
  formData: FormData,
  signal?: AbortSignal,
): Promise<T> {
  try {
    const response = await fetchWithRetry(endpoint, {
      method: "POST",
      body: formData,
      signal,
    });

    if (!response.ok) {
      throw await parseResponseError(response);
    }

    return await response.json();
  } catch (error) {
    throw toApiError(error);
  }
}

/**
 * Download a binary response (e.g. parquet/zip export) as a Blob.
 * Routes through the shared fetch wrapper so it gets the Electron transient-
 * network retry, and accepts an optional AbortSignal for cancellation.
 */
export async function requestBinary(
  endpoint: string,
  method: "GET" | "POST" = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<Blob> {
  try {
    const response = await fetchWithRetry(endpoint, {
      method,
      headers:
        body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });

    if (!response.ok) {
      throw await parseResponseError(response);
    }

    return await response.blob();
  } catch (error) {
    throw toApiError(error);
  }
}
