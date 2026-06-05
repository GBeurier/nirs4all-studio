/**
 * API client for nirs4all backend communication
 */

import {
  addDiagnosticsBreadcrumb,
  captureDiagnosticsError,
} from "@/lib/diagnostics";
import { logger } from "@/lib/logger";

// Default API base URL for web mode (uses Vite proxy)
const DEFAULT_API_BASE_URL = "/api";

// Cache for the resolved backend URL in Electron mode
let resolvedBackendUrl: string | null = null;
let backendUrlPromise: Promise<string> | null = null;

// Header the Electron backend expects to authenticate state-changing requests.
const API_TOKEN_HEADER = "X-Nirs4all-Token";

// Cache for the resolved API token in Electron mode. Empty string means "web
// mode / no token" (resolved once, then reused).
let resolvedApiToken: string | null = null;
let apiTokenPromise: Promise<string> | null = null;

/**
 * Detect if we're running in Electron.
 * Uses multiple detection methods since electronApi may not be available immediately.
 */
function isElectronEnvironment(): boolean {
  if (typeof window === "undefined") return false;

  // Check if electronApi is exposed (preferred method)
  if ((window as unknown as { electronApi?: { isElectron?: boolean } }).electronApi?.isElectron) {
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
    if ((window as unknown as { electronApi?: { getBackendUrl?: () => Promise<string> } }).electronApi?.getBackendUrl) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return false;
}

/**
 * Get the API base URL, resolving Electron backend URL if needed.
 * In Electron mode, this fetches the dynamic port from the main process.
 * In web mode, it returns "/api" (which Vite proxies to the backend).
 */
async function getApiBaseUrl(): Promise<string> {
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
          console.error("electronApi not available after waiting");
          throw new Error("electronApi not available");
        }

        const electronApi = (window as unknown as { electronApi: { getBackendUrl: () => Promise<string> } }).electronApi;
        const backendUrl = await electronApi.getBackendUrl();
        resolvedBackendUrl = `${backendUrl}/api`;
        logger.log(`[API Client] Using Electron backend URL: ${resolvedBackendUrl}`);
        return resolvedBackendUrl;
      } catch (error) {
        console.error("Failed to get backend URL from Electron:", error);
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
 * Resolve the API token once. In Electron mode this fetches the per-launch
 * token from the main process; in web mode it returns "" (no token), so dev
 * requests are unaffected. The result is cached after the first call.
 */
async function getApiToken(): Promise<string> {
  if (resolvedApiToken !== null) {
    return resolvedApiToken;
  }

  if (apiTokenPromise !== null) {
    return apiTokenPromise;
  }

  if (!isElectronEnvironment()) {
    resolvedApiToken = "";
    return resolvedApiToken;
  }

  apiTokenPromise = (async () => {
    try {
      const apiAvailable = await waitForElectronApi();
      const electronApi = (window as unknown as {
        electronApi?: { getApiToken?: () => Promise<string> };
      }).electronApi;
      if (!apiAvailable || !electronApi?.getApiToken) {
        console.error("electronApi.getApiToken not available");
        resolvedApiToken = "";
        return resolvedApiToken;
      }
      resolvedApiToken = (await electronApi.getApiToken()) || "";
      return resolvedApiToken;
    } catch (error) {
      console.error("Failed to get API token from Electron:", error);
      resolvedApiToken = "";
      return resolvedApiToken;
    }
  })();
  return apiTokenPromise;
}

/**
 * Authenticated `fetch` for the few call sites that need the raw `Response`
 * (custom error handling, multipart, etc.) instead of the typed `ApiClient`
 * methods. Resolves the backend base URL (so it works in packaged Electron, not
 * just behind the Vite proxy) and attaches the `X-Nirs4all-Token` header in
 * desktop mode — making these calls behave identically to `ApiClient` requests.
 *
 * @param endpoint Path relative to the `/api` base, e.g. `/synthesis/generate`.
 * @param init     Standard `fetch` init; its headers are preserved and merged.
 */
export async function authorizedFetch(
  endpoint: string,
  init: RequestInit = {}
): Promise<Response> {
  const baseUrl = await getApiBaseUrl();
  const token = await getApiToken();
  const headers = new Headers(init.headers);
  if (token) {
    headers.set(API_TOKEN_HEADER, token);
  }
  return fetch(`${baseUrl}${endpoint}`, { ...init, headers });
}

interface ApiError {
  detail: string;
  status: number;
}

export class ApiRequestError extends Error implements ApiError {
  detail: string;
  status: number;

  constructor(detail: string, status: number) {
    super(detail);
    this.name = "ApiRequestError";
    this.detail = detail;
    this.status = status;
  }
}

function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { status?: unknown }).status === "number"
  );
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

class ApiClient {
  private async request<T>(
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const baseUrl = await getApiBaseUrl();
    const token = await getApiToken();
    const url = `${baseUrl}${endpoint}`;
    const { body, ...restOptions } = options;

    const config: RequestInit = {
      headers: {
        "Content-Type": "application/json",
        ...(token ? { [API_TOKEN_HEADER]: token } : {}),
        ...options.headers,
      },
      ...restOptions,
      body: body ? JSON.stringify(body) : undefined,
    };

    try {
      const response = await fetch(url, config);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const error = new ApiRequestError(
          errorData.detail || `HTTP error ${response.status}`,
          response.status
        );
        if (response.status >= 500) {
          captureDiagnosticsError(new Error(error.detail), {
            tags: {
              surface: "api_client",
              endpoint,
              status: response.status,
              method: config.method || "GET",
            },
            extra: { url },
          });
        }
        throw error;
      }

      addDiagnosticsBreadcrumb({
        category: "api",
        level: "info",
        message: `${config.method || "GET"} ${endpoint}`,
        data: { status: response.status },
      });

      return await response.json();
    } catch (error) {
      if (isApiError(error)) {
        throw error;
      }
      // Preserve AbortError for proper handling by callers
      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }
      captureDiagnosticsError(error, {
        tags: {
          surface: "api_client",
          endpoint,
          method: config.method || "GET",
          status: 0,
        },
        extra: { url },
      });
      throw new ApiRequestError(
        error instanceof Error ? error.message : "Network error",
        0
      );
    }
  }

  // GET request
  async get<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { method: "GET", ...options });
  }

  // POST request
  async post<T>(endpoint: string, data?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, {
      method: "POST",
      body: data,
      ...options,
    });
  }

  // PUT request
  async put<T>(endpoint: string, data?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, {
      method: "PUT",
      body: data,
      ...options,
    });
  }

  // DELETE request
  async delete<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { method: "DELETE", ...options });
  }
}

export const api = new ApiClient();

// Health check
export async function checkHealth(): Promise<{ status: string }> {
  return api.get("/health");
}
