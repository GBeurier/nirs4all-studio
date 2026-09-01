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
const WORKSPACE_RUN_DETAIL_ENDPOINT =
  /^\/workspaces\/([^/?]+)\/runs\/([^/?]+)$/;

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
  getScientificPluginUrl?: () => Promise<string>;
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
  preselectRendererTransport?: (request:
    | { kind: "http"; method: string; path: string }
    | { kind: "websocket"; path: string },
  ) => Promise<{
    schema_id: "nirs4all.studio-renderer-transport-selection-decision.v1";
    kind: "http" | "websocket";
    method: string | null;
    path: string;
    surface: string;
    target: "native-sidecar" | "scientific-plugin" | "reject";
    base_url: string | null;
    renderer_transport: boolean;
    scientific_execution: false;
    reason: string;
    fallback_after_native_selection: "none";
    status: number;
  }>;
  preselectWorkspaceRunDetail?: (workspaceId: string) => Promise<{
    schema_id: "nirs4all.studio-run-detail-preselection-decision.v1";
    workspace_id: string;
    target: "native-sidecar" | "scientific-plugin" | "reject";
    verified_store_v5: boolean;
    store_schema_version: 5 | null;
    reason: string;
    fallback_after_native_selection: "none";
    status: number;
  }>;
}

type ApiRoute = {
  baseUrl: string;
  source: "web-backend" | "python-http-diagnostic" | "native-sidecar";
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

async function waitForRendererTransportApi(
  maxWaitMs: number = 5000,
): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    if (getElectronBridge()?.preselectRendererTransport) {
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
 * Get the web API base URL. Electron requests must always carry a route through
 * preselection; a generic base URL could otherwise acquire Python implicitly.
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
    throw {
      detail: "Electron API requests require explicit renderer transport preselection",
      status: 500,
      code: "STUDIO_RENDERER_ROUTE_REQUIRED",
    } satisfies ApiError;
  }

  // Web mode - use relative URL (Vite proxy)
  resolvedBackendUrl = DEFAULT_API_BASE_URL;
  return resolvedBackendUrl;
}

async function acquirePythonHttpDiagnosticRoute(): Promise<ApiRoute> {
  if (resolvedBackendUrl !== null) {
    return {
      baseUrl: resolvedBackendUrl,
      source: "python-http-diagnostic",
    };
  }
  if (!backendUrlPromise) {
    const bridge = getElectronBridge();
    if (!bridge?.getScientificPluginUrl) {
      throw {
        detail: "Explicit Python HTTP diagnostic IPC is unavailable",
        status: 503,
        code: "STUDIO_PYTHON_HTTP_DIAGNOSTIC_UNAVAILABLE",
      } satisfies ApiError;
    }
    backendUrlPromise = bridge.getScientificPluginUrl()
      .then((backendUrl) => {
        resolvedBackendUrl = `${backendUrl}/api`;
        return resolvedBackendUrl;
      })
      .catch((error) => {
        backendUrlPromise = null;
        throw error;
      });
  }
  return {
    baseUrl: await backendUrlPromise,
    source: "python-http-diagnostic",
  };
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
  const runDetail = WORKSPACE_RUN_DETAIL_ENDPOINT.exec(endpoint);
  if (
    runDetail &&
    method.toUpperCase() === "GET" &&
    isElectronEnvironment()
  ) {
    return resolveWorkspaceRunDetailRoute(runDetail[1]);
  }
  if (!isElectronEnvironment()) {
    return { baseUrl: await getApiBaseUrl(), source: "web-backend" };
  }
  let selector = getElectronBridge()?.preselectRendererTransport;
  if (!selector && await waitForRendererTransportApi()) {
    selector = getElectronBridge()?.preselectRendererTransport;
  }
  if (!selector) {
    throw {
      detail: "Renderer transport preselection IPC is unavailable",
      status: 503,
    } satisfies ApiError;
  }
  const normalizedMethod = method.toUpperCase();
  const decision = await selector({
    kind: "http",
    method: normalizedMethod,
    path: endpoint,
  });
  if (
    decision.schema_id !==
      "nirs4all.studio-renderer-transport-selection-decision.v1" ||
    decision.kind !== "http" ||
    decision.method !== normalizedMethod ||
    decision.path !== endpoint ||
    decision.fallback_after_native_selection !== "none" ||
    decision.scientific_execution !== false
  ) {
    throw {
      detail: "Renderer transport preselection returned an invalid decision",
      status: 500,
    } satisfies ApiError;
  }
  if (decision.target === "scientific-plugin") {
    if (
      decision.surface !== "python-http-diagnostic" ||
      decision.reason !== "explicit_python_http_diagnostic_mode"
    ) {
      throw {
        detail: "Python HTTP target was not explicitly diagnostic-selected",
        status: 500,
        code: "STUDIO_INVALID_PYTHON_HTTP_SELECTION",
      } satisfies ApiError;
    }
    return acquirePythonHttpDiagnosticRoute();
  }
  if (decision.target === "reject") {
    throw {
      detail: `Renderer transport preselection rejected the request: ${decision.reason}`,
      status: decision.status,
      code: "STUDIO_NATIVE_ROUTE_UNAVAILABLE",
    } satisfies ApiError;
  }
  if (!decision.renderer_transport || !decision.base_url) {
    throw {
      detail: "Native renderer transport decision is incomplete",
      status: 500,
    } satisfies ApiError;
  }
  const baseUrl = `${decision.base_url}/api`;
  logger.info(`Using preflighted native sidecar route for ${endpoint}: ${baseUrl}`);
  return { baseUrl, source: "native-sidecar" };
}

async function resolveWorkspaceRunDetailRoute(
  encodedWorkspaceId: string,
): Promise<ApiRoute> {
  const bridge = getElectronBridge();
  if (!bridge?.preselectWorkspaceRunDetail) {
    throw {
      detail: "Native run-detail preselection IPC is unavailable",
      status: 503,
      code: "STUDIO_RUN_DETAIL_PRESELECTION_UNAVAILABLE",
    } satisfies ApiError;
  }
  let workspaceId: string;
  try {
    workspaceId = decodeURIComponent(encodedWorkspaceId);
  } catch {
    throw { detail: "Invalid workspace identifier", status: 400 } satisfies ApiError;
  }

  const decision = await bridge.preselectWorkspaceRunDetail(workspaceId);
  if (decision.target === "scientific-plugin") {
    if (decision.reason !== "explicit_python_http_diagnostic_mode") {
      throw {
        detail: "Python HTTP run-detail target was not explicitly diagnostic-selected",
        status: 500,
        code: "STUDIO_INVALID_PYTHON_HTTP_SELECTION",
      } satisfies ApiError;
    }
    return acquirePythonHttpDiagnosticRoute();
  }
  if (decision.target === "reject") {
    throw {
      detail: `Native run-detail preselection rejected the request: ${decision.reason}`,
      status: decision.status,
      code: "STUDIO_NATIVE_RUN_DETAIL_UNAVAILABLE",
    } satisfies ApiError;
  }

  const info = await bridge.getNativeSidecarInfo?.();
  if (
    info?.status !== "running" ||
    !info.url ||
    !info.pythonPluginHostConfigured
  ) {
    throw {
      detail: "Native run-detail selection became unavailable",
      status: 503,
    } satisfies ApiError;
  }
  return { baseUrl: `${info.url}/api`, source: "native-sidecar" };
}

export interface ApiError {
  detail: string;
  status: number;
  code?: string;
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
        route.source === "python-http-diagnostic" &&
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
