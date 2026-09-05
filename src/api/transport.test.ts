/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, formatApiErrorDetail, resetBackendUrl } from "./transport";
import { getConfigDiff, getRecommendedConfig } from "./config";
import {
  preselectRendererTransport,
  type RendererTransportRequest,
} from "../../electron/renderer-transport-selection";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const MAX_BOUNDED_JSON_BYTES = 2 * 1024 * 1024;

function jsonWithExactBytes(size: number): string {
  const empty = JSON.stringify({ padding: "" });
  if (size < empty.length) throw new RangeError("JSON size is too small");
  return JSON.stringify({ padding: "x".repeat(size - empty.length) });
}

type RendererElectronApi = NonNullable<Window["electronApi"]>;
// Test-only trap: prove transport never calls the retired Python HTTP API.
type ElectronApiTestFixture = RendererElectronApi & {
  getScientificPluginUrl: () => Promise<string | null>;
};

function createElectronApiMock(
  overrides: Partial<ElectronApiTestFixture> = {},
): ElectronApiTestFixture {
  const electronApi = {
    selectFolder: vi.fn().mockResolvedValue(null),
    confirmDroppedFolder: vi.fn().mockResolvedValue(null),
    selectFile: vi.fn().mockResolvedValue(null),
    saveFile: vi.fn().mockResolvedValue(null),
    revealInExplorer: vi.fn().mockResolvedValue(undefined),
    openExternal: vi.fn().mockResolvedValue(undefined),
    getLogPath: vi.fn().mockResolvedValue(null),
    openLogDir: vi.fn().mockResolvedValue(undefined),
    getTelemetryConsent: vi.fn().mockResolvedValue("unset"),
    setTelemetryConsent: vi.fn().mockResolvedValue({
      status: "declined",
      decidedAt: "2026-04-18T08:00:00",
    }),
    resizeWindow: vi.fn().mockResolvedValue(true),
    minimizeWindow: vi.fn().mockResolvedValue(true),
    maximizeWindow: vi.fn().mockResolvedValue(true),
    restoreWindow: vi.fn().mockResolvedValue(true),
    getWindowSize: vi.fn().mockResolvedValue({ width: 1024, height: 768 }),
    getBackendPort: vi.fn().mockResolvedValue(8000),
    getBackendUrl: vi.fn().mockResolvedValue("http://127.0.0.1:8000"),
    getScientificPluginUrl: vi.fn().mockResolvedValue("http://127.0.0.1:8000"),
    getBackendInfo: vi.fn().mockResolvedValue({
      status: "running",
      port: 8000,
      url: "http://127.0.0.1:8000",
      restartCount: 0,
    }),
    getNativeSidecarInfo: vi.fn().mockResolvedValue({
      status: "disabled",
      host: null,
      port: null,
      protocolVersion: null,
      url: null,
      pythonPluginHostConfigured: false,
    }),
    preselectWorkspaceRunDetail: vi.fn().mockResolvedValue({
      schema_id: "nirs4all.studio-run-detail-preselection-decision.v1",
      workspace_id: "workspace-a",
      target: "native-sidecar",
      verified_store_v5: true,
      store_schema_version: 5,
      reason: "store_v5_owner_materializer_ready",
      fallback_after_native_selection: "none",
      status: 200,
    }),
    getControlPlaneInfo: vi.fn().mockResolvedValue({
      role: "control-plane",
      ready: true,
      status: "running",
      host: "127.0.0.1",
      port: 43123,
      protocolVersion: "studio-sidecar-r1",
      url: "http://127.0.0.1:43123",
      pythonPluginHostConfigured: false,
    }),
    getScientificPluginInfo: vi.fn().mockResolvedValue({
      role: "scientific-plugin",
      ready: true,
      requested: true,
      status: "running",
      port: 8000,
      url: "http://127.0.0.1:8000",
      restartCount: 0,
    }),
    getScientificReadiness: vi.fn().mockResolvedValue({
      scientific_status: "running",
      scientific_requested: true,
      core_ready: true,
      ml_ready: true,
      ml_loading: false,
      ml_error: null,
      workspace_ready: true,
    }),
    restartBackend: vi.fn().mockResolvedValue({ success: true }),
    restartScientificPlugin: vi.fn().mockResolvedValue({ success: true }),
    onBackendStatusChanged: vi.fn(() => () => undefined),
    onScientificPluginStatusChanged: vi.fn(() => () => undefined),
    getEnvStatus: vi.fn().mockResolvedValue("ready"),
    isEnvReady: vi.fn().mockResolvedValue(true),
    getEnvInfo: vi.fn().mockResolvedValue({
      status: "ready",
      envDir: "",
      pythonPath: null,
      sitePackages: null,
      pythonVersion: null,
      isCustom: false,
    }),
    detectExistingEnvs: vi.fn().mockResolvedValue([]),
    inspectExistingEnv: vi
      .fn()
      .mockResolvedValue({ success: true, message: "" }),
    useExistingEnv: vi.fn().mockResolvedValue({ success: true, message: "" }),
    selectPythonExe: vi.fn().mockResolvedValue(null),
    inspectExistingPython: vi
      .fn()
      .mockResolvedValue({ success: true, message: "" }),
    useExistingPython: vi
      .fn()
      .mockResolvedValue({ success: true, message: "" }),
    applyExistingEnv: vi.fn().mockResolvedValue({ success: true, message: "" }),
    applyExistingPython: vi
      .fn()
      .mockResolvedValue({ success: true, message: "" }),
    startEnvSetup: vi.fn().mockResolvedValue({ success: true }),
    onEnvSetupProgress: vi.fn(() => () => undefined),
    shouldShowWizard: vi.fn().mockResolvedValue(false),
    markWizardComplete: vi.fn().mockResolvedValue(undefined),
    getCurrentEnvSummary: vi.fn().mockResolvedValue(null),
    isPortable: vi.fn().mockResolvedValue(false),
    platform: "linux",
    isElectron: true,
    getPathForFile: vi.fn(() => ""),
    ...overrides,
  } as ElectronApiTestFixture;
  if (!overrides.preselectRendererTransport) {
    electronApi.preselectRendererTransport = vi.fn<RendererElectronApi["preselectRendererTransport"]>(async (request) => {
      const info = await electronApi.getNativeSidecarInfo();
      const candidatePath = request.kind === "http" ? request.path : "";
      const candidateMethod = request.kind === "http" ? request.method : "";
      const native = info.status === "running" && Boolean(info.url) &&
        mockNativeCandidate(candidatePath, candidateMethod) &&
        (!mockRequiresPythonHost(candidatePath) || info.pythonPluginHostConfigured);
      return {
        schema_id: "nirs4all.studio-renderer-transport-selection-decision.v1",
        kind: request.kind,
        method: request.kind === "http" ? request.method.toUpperCase() : null,
        path: request.path,
        surface: native ? "test-native" : "unmigrated",
        target: native ? "native-sidecar" : "reject",
        base_url: native ? info.url : null,
        renderer_transport: native,
        scientific_execution: false,
        reason: native
          ? "test_native_preflight"
          : "route_not_native_qualified_rust_only",
        fallback_after_native_selection: "none",
        status: native ? 200 : 501,
      };
    });
  }
  return electronApi;
}

function mockRequiresPythonHost(path: string): boolean {
  return [
    "/workspace/legacy-convert",
    "/system/capabilities",
    "/system/info",
    "/system/build",
    "/system/env-coherence",
    "/updates/version",
    "/updates/runtime/status",
  ].includes(path);
}

function mockNativeCandidate(path: string, method: string): boolean {
  if ([
    "/health",
    "/app/settings",
    "/app/favorites",
    "/app/config-path",
    "/workspaces",
    "/workspace/transition-status",
    "/workspace/legacy-convert",
    "/system/status",
    "/system/network",
    "/updates/settings",
    "/system/capabilities",
    "/system/info",
    "/system/build",
    "/system/env-coherence",
    "/updates/version",
    "/updates/runtime/status",
  ].includes(path) ||
    path.startsWith("/app/favorites/") ||
    ((method === "POST" || method === "DELETE") &&
      /^\/workspaces\/[^/?]+(?:\/activate)?$/.test(path))) return true;
  if (method !== "GET") return false;
  if (/^\/workspaces\/[^/?]+\/results(?:\/summary)?$/.test(path)) return true;
  const runs = /^\/workspaces\/[^/?]+\/runs(?:\?([^#]+))?$/.exec(path);
  if (!runs) return false;
  if (runs[1] === undefined) return true;
  const seen = new Set<string>();
  for (const parameter of runs[1].split("&")) {
    const [name, value, extra] = parameter.split("=");
    if (extra !== undefined || seen.has(name)) return false;
    if (
      (name === "source" && ["unified", "manifests", "parquet"].includes(value)) ||
      (name === "refresh" && ["true", "false"].includes(value))
    ) {
      seen.add(name);
    } else {
      return false;
    }
  }
  return seen.size > 0;
}

function rendererSelection(
  method: string,
  path: string,
  target: "native-sidecar" | "reject",
) {
  return {
    schema_id: "nirs4all.studio-renderer-transport-selection-decision.v1" as const,
    kind: "http" as const,
    method,
    path,
    surface: "test-surface",
    target,
    base_url: target === "native-sidecar" ? "http://127.0.0.1:43123" : null,
    renderer_transport: target === "native-sidecar",
    scientific_execution: false as const,
    reason: target === "reject"
      ? "native_capability_mismatch"
      : "test_selection",
    fallback_after_native_selection: "none" as const,
    status: target === "reject" ? 503 : 200,
  };
}

function installNativeArchiveResponse(
  response: Response,
  method = "POST",
  path = "/predict/archive-v2",
) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  const acquire = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  window.electronApi = createElectronApiMock({
    getScientificPluginUrl: acquire,
    preselectRendererTransport: vi.fn().mockResolvedValue(
      rendererSelection(method, path, "native-sidecar"),
    ),
  });
  return { fetchMock, acquire };
}

beforeEach(() => {
  resetBackendUrl();
});

afterEach(() => {
  resetBackendUrl();
  vi.unstubAllGlobals();
  delete window.electronApi;
});

describe("formatApiErrorDetail", () => {
  it("formats FastAPI validation arrays into readable messages", () => {
    const detail = [
      {
        type: "string_too_long",
        loc: ["body", "config", "name"],
        msg: "String should have at most 100 characters",
      },
    ];

    expect(formatApiErrorDetail(detail, 422)).toBe(
      "config.name: String should have at most 100 characters",
    );
  });

  it("passes string details through unchanged", () => {
    expect(formatApiErrorDetail("Dataset not found", 404)).toBe(
      "Dataset not found",
    );
  });
});

describe("API client request handling", () => {
  it("uses the preflighted native scientific submission transport without acquiring Python", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        protocol_version: "studio-sidecar-r1",
        features: {
          renderer_transport_selection: true,
          renderer_rust_only_default: true,
          implicit_python_http_fallback: false,
          unmigrated_renderer_routes_fail_closed: true,
          renderer_http_transport: true,
          scientific_submission_transport: true,
          scientific_execution: false,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        job_id: "job-1",
        status: "running",
        scientific_execution: false,
      }, 202));
    vi.stubGlobal("fetch", fetchMock);
    const acquire = vi.fn();
    const inspectSidecar = vi.fn(() => ({
      status: "running" as const,
      url: "http://127.0.0.1:43123",
      pythonPluginHostConfigured: false,
    }));
    const preselect = vi.fn((request: RendererTransportRequest) =>
      preselectRendererTransport(request, inspectSidecar, fetchMock));
    window.electronApi = createElectronApiMock({
      getScientificPluginUrl: acquire,
      getNativeSidecarInfo: vi.fn(async () => ({ ...inspectSidecar(), host: "127.0.0.1", port: 43123, protocolVersion: "studio-sidecar-r1" })),
      preselectRendererTransport: preselect,
    });

    await api.post("/runs/run-groups", { engine: "dag-ml" });

    expect(preselect).toHaveBeenCalledWith({
      kind: "http",
      method: "POST",
      path: "/runs/run-groups",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:43123/sidecar/v1/capabilities",
      { method: "GET", cache: "no-store" },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:43123/api/runs/run-groups",
      expect.objectContaining({ method: "POST" }),
    );
    expect(inspectSidecar).toHaveBeenCalledOnce();
    expect(acquire).not.toHaveBeenCalled();
  });

  it("uses the preflighted native Archive V2 prediction route without acquiring Python", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        protocol_version: "studio-sidecar-r1",
        features: {
          renderer_transport_selection: true,
          renderer_rust_only_default: true,
          implicit_python_http_fallback: false,
          unmigrated_renderer_routes_fail_closed: true,
          renderer_http_transport: true,
          native_archive_v2_prediction: true,
          scientific_execution: false,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ predictions: [[1.25]] }));
    vi.stubGlobal("fetch", fetchMock);
    const acquire = vi.fn();
    const inspectSidecar = vi.fn(() => ({
      status: "running" as const,
      url: "http://127.0.0.1:43123",
      pythonPluginHostConfigured: false,
    }));
    const preselect = vi.fn((request: RendererTransportRequest) =>
      preselectRendererTransport(request, inspectSidecar, fetchMock));
    window.electronApi = createElectronApiMock({
      getScientificPluginUrl: acquire,
      getNativeSidecarInfo: vi.fn(async () => ({ ...inspectSidecar(), host: "127.0.0.1", port: 43123, protocolVersion: "studio-sidecar-r1" })),
      preselectRendererTransport: preselect,
    });
    const body = {
      schema_version: 1,
      operation: "archive_v2_predict",
      workspace_id: "workspace-a",
    };

    await api.post("/predict/archive-v2", body);

    expect(preselect).toHaveBeenCalledWith({
      kind: "http",
      method: "POST",
      path: "/predict/archive-v2",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:43123/api/predict/archive-v2",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
    expect(inspectSidecar).toHaveBeenCalledOnce();
    expect(acquire).not.toHaveBeenCalled();
  });

  it("accepts valid JSON at the exact raw response-byte cap", async () => {
    const body = jsonWithExactBytes(MAX_BOUNDED_JSON_BYTES);
    expect(new TextEncoder().encode(body)).toHaveLength(
      MAX_BOUNDED_JSON_BYTES,
    );
    const { fetchMock, acquire } = installNativeArchiveResponse(
      new Response(body, {
        headers: { "Content-Length": String(MAX_BOUNDED_JSON_BYTES) },
      }),
    );

    const result = await api.postBoundedJson<{ padding: string }>(
      "/predict/archive-v2",
      { request: true },
      MAX_BOUNDED_JSON_BYTES,
    );

    expect(result.padding).toHaveLength(
      MAX_BOUNDED_JSON_BYTES - JSON.stringify({ padding: "" }).length,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(acquire).not.toHaveBeenCalled();
  });

  it("bounds the native Archive V2 catalogue GET without Python acquisition", async () => {
    const { fetchMock, acquire } = installNativeArchiveResponse(
      new Response(JSON.stringify({ archives: [] })),
      "GET",
      "/workspaces/workspace-a/archive-v2",
    );
    await expect(api.getBoundedJson("/workspaces/workspace-a/archive-v2", MAX_BOUNDED_JSON_BYTES))
      .resolves.toEqual({ archives: [] });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:43123/api/workspaces/workspace-a/archive-v2", expect.objectContaining({ method: "GET" }));
    expect(acquire).not.toHaveBeenCalled();
  });

  it("refuses cap-plus-one raw bytes even when the excess is JSON whitespace", async () => {
    const body = `${jsonWithExactBytes(MAX_BOUNDED_JSON_BYTES)} `;
    expect(new TextEncoder().encode(body)).toHaveLength(
      MAX_BOUNDED_JSON_BYTES + 1,
    );
    installNativeArchiveResponse(
      new Response(body, {
        headers: { "Content-Length": String(MAX_BOUNDED_JSON_BYTES + 1) },
      }),
    );

    await expect(
      api.postBoundedJson(
        "/predict/archive-v2",
        {},
        MAX_BOUNDED_JSON_BYTES,
      ),
    ).rejects.toMatchObject({
      status: 502,
      code: "STUDIO_BOUNDED_JSON_RESPONSE_INVALID",
      detail: expect.stringContaining("exceeds"),
    });
  });

  it.each([
    ["invalid", "unknown"],
    ["oversized", String(MAX_BOUNDED_JSON_BYTES + 1)],
  ])(
    "cancels an open response stream for %s Content-Length",
    async (_label, contentLength) => {
      const cancel = vi.fn();
      const stream = new ReadableStream<Uint8Array>({ cancel });
      installNativeArchiveResponse(
        new Response(stream, {
          headers: { "Content-Length": contentLength },
        }),
      );

      await expect(
        api.postBoundedJson(
          "/predict/archive-v2",
          {},
          MAX_BOUNDED_JSON_BYTES,
        ),
      ).rejects.toMatchObject({
        status: 502,
        code: "STUDIO_BOUNDED_JSON_RESPONSE_INVALID",
      });
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it("does not trust a false lower Content-Length", async () => {
    const body = `${jsonWithExactBytes(MAX_BOUNDED_JSON_BYTES)} `;
    installNativeArchiveResponse(
      new Response(body, { headers: { "Content-Length": "2" } }),
    );

    await expect(
      api.postBoundedJson(
        "/predict/archive-v2",
        {},
        MAX_BOUNDED_JSON_BYTES,
      ),
    ).rejects.toMatchObject({
      status: 502,
      detail: expect.stringContaining("exceeds"),
    });
  });

  it("bounds a missing Content-Length while still accepting a small body", async () => {
    installNativeArchiveResponse(new Response(JSON.stringify({ ok: true })));
    await expect(
      api.postBoundedJson(
        "/predict/archive-v2",
        {},
        MAX_BOUNDED_JSON_BYTES,
      ),
    ).resolves.toEqual({ ok: true });

    installNativeArchiveResponse(
      new Response(`${jsonWithExactBytes(MAX_BOUNDED_JSON_BYTES)} `),
    );
    await expect(
      api.postBoundedJson(
        "/predict/archive-v2",
        {},
        MAX_BOUNDED_JSON_BYTES,
      ),
    ).rejects.toMatchObject({
      status: 502,
      detail: expect.stringContaining("exceeds"),
    });
  });

  it("refuses hostile Content-Length syntax and invalid JSON", async () => {
    installNativeArchiveResponse(
      new Response("{}", { headers: { "Content-Length": "unknown" } }),
    );
    await expect(
      api.postBoundedJson(
        "/predict/archive-v2",
        {},
        MAX_BOUNDED_JSON_BYTES,
      ),
    ).rejects.toMatchObject({
      status: 502,
      detail: expect.stringContaining("invalid Content-Length"),
    });

    installNativeArchiveResponse(new Response("{not-json"));
    await expect(
      api.postBoundedJson(
        "/predict/archive-v2",
        {},
        MAX_BOUNDED_JSON_BYTES,
      ),
    ).rejects.toMatchObject({
      status: 502,
      detail: expect.stringContaining("not valid JSON"),
    });
  });

  it("does not issue, retry, or acquire Python after renderer preflight rejects", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const acquire = vi.fn();
    window.electronApi = createElectronApiMock({
      getScientificPluginUrl: acquire,
      preselectRendererTransport: vi.fn().mockResolvedValue(
        rendererSelection("GET", "/training/job-1", "reject"),
      ),
    });

    await expect(api.get("/training/job-1")).rejects.toMatchObject({
      detail: expect.stringContaining("native_capability_mismatch"),
      status: 503,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(acquire).not.toHaveBeenCalled();
  });

  it("keeps an unknown native job on Rust and never consults Python ownership", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        protocol_version: "studio-sidecar-r1",
        features: {
          renderer_transport_selection: true,
          renderer_rust_only_default: true,
          implicit_python_http_fallback: false,
          unmigrated_renderer_routes_fail_closed: true,
          renderer_http_transport: true,
          native_job_status_routes: true,
          scientific_execution: false,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        detail: "Unknown native job 'job-missing'",
      }, 404));
    const acquire = vi.fn();
    const inspectSidecar = vi.fn(() => ({
      status: "running" as const,
      url: "http://127.0.0.1:43123",
      pythonPluginHostConfigured: false,
    }));
    vi.stubGlobal("fetch", fetchMock);
    window.electronApi = createElectronApiMock({
      getScientificPluginUrl: acquire,
      preselectRendererTransport: vi.fn((request: RendererTransportRequest) =>
        preselectRendererTransport(request, inspectSidecar, fetchMock)),
    });

    await expect(api.get("/training/job-missing")).rejects.toMatchObject({
      detail: "Unknown native job 'job-missing'",
      status: 404,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(acquire).not.toHaveBeenCalled();
  });

  it("rejects an unmigrated route in Rust-only mode before fetch or Python acquisition", async () => {
    const fetchMock = vi.fn();
    const acquire = vi.fn();
    const inspectSidecar = vi.fn(() => ({
      status: "running" as const,
      url: "http://127.0.0.1:43123",
      pythonPluginHostConfigured: true,
    }));
    vi.stubGlobal("fetch", fetchMock);
    window.electronApi = createElectronApiMock({
      getScientificPluginUrl: acquire,
      preselectRendererTransport: vi.fn((request: RendererTransportRequest) =>
        preselectRendererTransport(request, inspectSidecar, fetchMock)),
    });

    // Dataset listing is now a native route. Keep this negative test on an
    // intentionally unknown route instead of requiring a restored feature to fail.
    await expect(api.get("/__unqualified_test_route")).rejects.toMatchObject({
      detail: expect.stringContaining("route_not_native_qualified_rust_only"),
      status: 501,
      code: "STUDIO_NATIVE_ROUTE_UNAVAILABLE",
    });
    expect(inspectSidecar).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(acquire).not.toHaveBeenCalled();
  });

  it("adds include_latest=false only when the caller disables latest-version lookup", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        profile: "cpu",
        profile_label: "CPU",
        packages: [],
        aligned_count: 0,
        misaligned_count: 0,
        missing_count: 0,
        is_aligned: true,
        checked_at: "2026-04-18T08:00:00",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getConfigDiff("cpu", false, false);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/config/diff?profile=cpu&include_latest=false",
      expect.any(Object),
    );
  });

  it("sends the migrated capabilities route to a running native sidecar without retrying Python", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ capabilities: { nirs4all: true } }));
    vi.stubGlobal("fetch", fetchMock);
    const getNativeSidecarInfo = vi.fn().mockResolvedValue({
      status: "running",
      host: "127.0.0.1",
      port: 43123,
      protocolVersion: "studio-sidecar-r1",
      url: "http://127.0.0.1:43123",
      pythonPluginHostConfigured: true,
    });
    const getScientificPluginUrl = vi.fn().mockResolvedValue(
      "http://127.0.0.1:39026",
    );
    window.electronApi = createElectronApiMock({
      getNativeSidecarInfo,
      getScientificPluginUrl,
    });

    await api.get("/system/capabilities");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/api/system/capabilities",
      expect.any(Object),
    );
    expect(getNativeSidecarInfo).toHaveBeenCalledTimes(1);
    expect(getScientificPluginUrl).not.toHaveBeenCalled();
  });

  it("does not fall back to Python after selecting a native route", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    const getScientificPluginUrl = vi.fn().mockResolvedValue(
      "http://127.0.0.1:39026",
    );
    window.electronApi = createElectronApiMock({
      getScientificPluginUrl,
      getNativeSidecarInfo: vi.fn().mockResolvedValue({
        status: "running",
        host: "127.0.0.1",
        port: 43123,
        protocolVersion: "studio-sidecar-r1",
        url: "http://127.0.0.1:43123",
        pythonPluginHostConfigured: true,
      }),
    });

    await expect(api.get("/system/capabilities")).rejects.toEqual({
      detail: "Failed to fetch",
      status: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getScientificPluginUrl).not.toHaveBeenCalled();
  });

  it("sends the migrated system-info route to a running native sidecar", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ nirs4all_version: "0.12.0" }));
    vi.stubGlobal("fetch", fetchMock);
    window.electronApi = createElectronApiMock({
      getNativeSidecarInfo: vi.fn().mockResolvedValue({
        status: "running",
        host: "127.0.0.1",
        port: 43123,
        protocolVersion: "studio-sidecar-r1",
        url: "http://127.0.0.1:43123",
        pythonPluginHostConfigured: true,
      }),
    });

    await api.get("/system/info");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/api/system/info",
      expect.any(Object),
    );
  });

  it("sends the migrated system-build route to a running native sidecar", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      build: { flavor: "development", gpu_enabled: false },
      gpu: { cuda_available: false, metal_available: false, backends: {} },
      runtime_mode: "development",
      is_frozen: false,
      summary: { gpu_available: false },
    }));
    vi.stubGlobal("fetch", fetchMock);
    window.electronApi = createElectronApiMock({
      getNativeSidecarInfo: vi.fn().mockResolvedValue({
        status: "running",
        host: "127.0.0.1",
        port: 43123,
        protocolVersion: "studio-sidecar-r1",
        url: "http://127.0.0.1:43123",
        pythonPluginHostConfigured: true,
      }),
    });

    await api.get("/system/build");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/api/system/build",
      expect.any(Object),
    );
  });

  it("sends the migrated version inventory to a configured native sidecar", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      webapp_version: "0.9.1",
      nirs4all_version: "0.12.0",
      python_version: "3.11.9",
      platform: "Linux",
      machine: "x86_64",
    }));
    vi.stubGlobal("fetch", fetchMock);
    window.electronApi = createElectronApiMock({
      getNativeSidecarInfo: vi.fn().mockResolvedValue({
        status: "running",
        host: "127.0.0.1",
        port: 43123,
        protocolVersion: "studio-sidecar-r1",
        url: "http://127.0.0.1:43123",
        pythonPluginHostConfigured: true,
      }),
    });

    await api.get("/updates/version");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/api/updates/version",
      expect.any(Object),
    );
  });

  it("sends the migrated runtime status to a configured native sidecar", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      runtime: {
        path: "/opt/nirs4all/runtime",
        exists: true,
        is_valid: true,
        python_executable: "/opt/nirs4all/runtime/bin/python",
        python_version: "3.11.9",
        pip_version: "24.0",
        created_at: null,
        last_updated: null,
        size_bytes: 1024,
      },
      venv: {},
      packages: [],
      nirs4all_version: "0.12.0",
    }));
    vi.stubGlobal("fetch", fetchMock);
    window.electronApi = createElectronApiMock({
      getNativeSidecarInfo: vi.fn().mockResolvedValue({
        status: "running",
        host: "127.0.0.1",
        port: 43123,
        protocolVersion: "studio-sidecar-r1",
        url: "http://127.0.0.1:43123",
        pythonPluginHostConfigured: true,
      }),
    });

    await api.get("/updates/runtime/status");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/api/updates/runtime/status",
      expect.any(Object),
    );
  });

  it("sends native update settings to a running sidecar without a Python host", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      auto_check: true,
      check_interval_hours: 24,
      prerelease_channel: false,
      github_repo: "GBeurier/nirs4all-studio",
      pypi_package: "nirs4all",
      dismissed_versions: [],
      offline_mode: "auto",
    }));
    vi.stubGlobal("fetch", fetchMock);
    window.electronApi = createElectronApiMock({
      getNativeSidecarInfo: vi.fn().mockResolvedValue({
        status: "running",
        host: "127.0.0.1",
        port: 43123,
        protocolVersion: "studio-sidecar-r1",
        url: "http://127.0.0.1:43123",
        pythonPluginHostConfigured: false,
      }),
    });

    await api.put("/updates/settings", { offline_mode: "on" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/api/updates/settings",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("sends the migrated runtime-coherence route to a running native sidecar", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ core_ready: true }));
    vi.stubGlobal("fetch", fetchMock);
    window.electronApi = createElectronApiMock({
      getNativeSidecarInfo: vi.fn().mockResolvedValue({
        status: "running",
        host: "127.0.0.1",
        port: 43123,
        protocolVersion: "studio-sidecar-r1",
        url: "http://127.0.0.1:43123",
        pythonPluginHostConfigured: true,
      }),
    });

    await api.get("/system/env-coherence");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/api/system/env-coherence",
      expect.any(Object),
    );
  });

  it("sends native app settings to the sidecar without requiring a Python plugin host", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        version: "3.0",
        linked_workspaces_count: 0,
        favorite_pipelines: [],
        ui_preferences: { theme: "system" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    window.electronApi = createElectronApiMock({
      getNativeSidecarInfo: vi.fn().mockResolvedValue({
        status: "running",
        host: "127.0.0.1",
        port: 43123,
        protocolVersion: "studio-sidecar-r1",
        url: "http://127.0.0.1:43123",
        pythonPluginHostConfigured: false,
      }),
    });

    await api.get("/app/settings");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/api/app/settings",
      expect.any(Object),
    );
  });

  it("sends native favourite mutations to the sidecar without a Python host", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, removed: true }));
    vi.stubGlobal("fetch", fetchMock);
    window.electronApi = createElectronApiMock({
      getNativeSidecarInfo: vi.fn().mockResolvedValue({
        status: "running",
        host: "127.0.0.1",
        port: 43123,
        protocolVersion: "studio-sidecar-r1",
        url: "http://127.0.0.1:43123",
        pythonPluginHostConfigured: false,
      }),
    });

    await api.delete("/app/favorites/pipeline-a");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/api/app/favorites/pipeline-a",
      expect.any(Object),
    );
  });

  it("sends native config-path mutations to the sidecar without a Python host", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => jsonResponse({ success: true, requires_restart: true }));
    vi.stubGlobal("fetch", fetchMock);
    window.electronApi = createElectronApiMock({
      getNativeSidecarInfo: vi.fn().mockResolvedValue({
        status: "running",
        host: "127.0.0.1",
        port: 43123,
        protocolVersion: "studio-sidecar-r1",
        url: "http://127.0.0.1:43123",
        pythonPluginHostConfigured: false,
      }),
    });

    await api.post("/app/config-path", { path: "/tmp/nirs4all-config" });
    await api.delete("/app/config-path");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:43123/api/app/config-path",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:43123/api/app/config-path",
      expect.any(Object),
    );
  });

  it("sends the linked workspace catalogue to the sidecar without a Python host", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ workspaces: [], active_workspace_id: null, total: 0 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    window.electronApi = createElectronApiMock({
      getNativeSidecarInfo: vi.fn().mockResolvedValue({
        status: "running",
        host: "127.0.0.1",
        port: 43123,
        protocolVersion: "studio-sidecar-r1",
        url: "http://127.0.0.1:43123",
        pythonPluginHostConfigured: false,
      }),
    });

    await api.get("/workspaces");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/api/workspaces",
      expect.any(Object),
    );
  });

  it("sends native network state to the sidecar without a Python host", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ online: true, forced: false, mode: "auto", env_forced: false }),
    );
    vi.stubGlobal("fetch", fetchMock);
    window.electronApi = createElectronApiMock({
      getNativeSidecarInfo: vi.fn().mockResolvedValue({
        status: "running",
        host: "127.0.0.1",
        port: 43123,
        protocolVersion: "studio-sidecar-r1",
        url: "http://127.0.0.1:43123",
        pythonPluginHostConfigured: false,
      }),
    });

    await api.get("/system/network");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/api/system/network",
      expect.any(Object),
    );
  });

  it("sends native system status to the sidecar without a Python host", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: {
          workspace_loaded: false,
          workspace: null,
          nirs4all_available: false,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    window.electronApi = createElectronApiMock({
      getNativeSidecarInfo: vi.fn().mockResolvedValue({
        status: "running",
        host: "127.0.0.1",
        port: 43123,
        protocolVersion: "studio-sidecar-r1",
        url: "http://127.0.0.1:43123",
        pythonPluginHostConfigured: false,
      }),
    });

    await api.get("/system/status");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/api/system/status",
      expect.any(Object),
    );
  });

  it("sends the frozen native health contract to the sidecar without a Python host", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        core_ready: true,
        message: "nirs4all webapp is running",
        ml_loading: false,
        ml_ready: false,
        ready: true,
        status: "healthy",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    window.electronApi = createElectronApiMock({
      getNativeSidecarInfo: vi.fn().mockResolvedValue({
        status: "running",
        host: "127.0.0.1",
        port: 43123,
        protocolVersion: "studio-sidecar-r1",
        url: "http://127.0.0.1:43123",
        pythonPluginHostConfigured: false,
      }),
    });

    await api.get("/health");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/api/health",
      expect.any(Object),
    );
  });

  it("routes only native linked-workspace state mutations to the sidecar", async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
    window.electronApi = createElectronApiMock({
      getNativeSidecarInfo: vi.fn().mockResolvedValue({
        status: "running",
        host: "127.0.0.1",
        port: 43123,
        protocolVersion: "studio-sidecar-r1",
        url: "http://127.0.0.1:43123",
        pythonPluginHostConfigured: false,
      }),
    });

    await api.post("/workspaces/workspace-a/activate");
    await api.delete("/workspaces/workspace-a");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:43123/api/workspaces/workspace-a/activate",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:43123/api/workspaces/workspace-a",
      expect.any(Object),
    );
  });

  it("routes only the Store v5 run-summary endpoint to the native sidecar", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        jsonResponse({ workspace_id: "workspace-a", runs: [], total: 0 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    window.electronApi = createElectronApiMock({
      getNativeSidecarInfo: vi.fn().mockResolvedValue({
        status: "running",
        host: "127.0.0.1",
        port: 43123,
        protocolVersion: "studio-sidecar-r1",
        url: "http://127.0.0.1:43123",
        pythonPluginHostConfigured: false,
      }),
    });

    await api.get("/workspaces/workspace-a/runs");
    await api.get("/workspaces/workspace-a/runs?source=unified");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:43123/api/workspaces/workspace-a/runs",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:43123/api/workspaces/workspace-a/runs?source=unified",
      expect.any(Object),
    );
  });

  it("does not retry a native Store incompatibility through FastAPI", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          detail: "Workspace has no compatible native WorkspaceStore v5",
          code: "workspace_store_unavailable",
        },
        409,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    window.electronApi = createElectronApiMock({
      getNativeSidecarInfo: vi.fn().mockResolvedValue({
        status: "running",
        host: "127.0.0.1",
        port: 43123,
        protocolVersion: "studio-sidecar-r1",
        url: "http://127.0.0.1:43123",
        pythonPluginHostConfigured: false,
      }),
    });

    await expect(
      api.get("/workspaces/workspace-a/runs?source=unified"),
    ).rejects.toMatchObject({
      detail: "Workspace has no compatible native WorkspaceStore v5",
      status: 409,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/api/workspaces/workspace-a/runs?source=unified",
      expect.any(Object),
    );
  });

  it("routes an exact Store-v5 run detail to the preflighted native sidecar", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ run_id: "run-a" }));
    vi.stubGlobal("fetch", fetchMock);
    const getScientificPluginUrl = vi.fn();
    const preselectWorkspaceRunDetail = vi.fn().mockResolvedValue({
      schema_id: "nirs4all.studio-run-detail-preselection-decision.v1",
      workspace_id: "workspace-a",
      target: "native-sidecar",
      verified_store_v5: true,
      store_schema_version: 5,
      reason: "store_v5_owner_materializer_ready",
      fallback_after_native_selection: "none",
      status: 200,
    });
    window.electronApi = createElectronApiMock({
      getScientificPluginUrl,
      preselectWorkspaceRunDetail,
      getNativeSidecarInfo: vi.fn().mockResolvedValue({
        status: "running",
        host: "127.0.0.1",
        port: 43123,
        protocolVersion: "studio-sidecar-r1",
        url: "http://127.0.0.1:43123",
        pythonPluginHostConfigured: true,
      }),
    });

    await api.get("/workspaces/workspace-a/runs/run-a");

    expect(preselectWorkspaceRunDetail).toHaveBeenCalledWith("workspace-a");
    expect(getScientificPluginUrl).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/api/workspaces/workspace-a/runs/run-a",
      expect.any(Object),
    );
  });

  it("does not send a target request or fall back after native preselection rejects", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const getScientificPluginUrl = vi.fn();
    window.electronApi = createElectronApiMock({
      getScientificPluginUrl,
      preselectWorkspaceRunDetail: vi.fn().mockResolvedValue({
        schema_id: "nirs4all.studio-run-detail-preselection-decision.v1",
        workspace_id: "workspace-a",
        target: "reject",
        verified_store_v5: true,
        store_schema_version: 5,
        reason: "studio_run_detail_owner_preflight_failed",
        fallback_after_native_selection: "none",
        status: 503,
      }),
    });

    await expect(
      api.get("/workspaces/workspace-a/runs/run-a"),
    ).rejects.toMatchObject({
      detail: expect.stringContaining("studio_run_detail_owner_preflight_failed"),
      status: 503,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getScientificPluginUrl).not.toHaveBeenCalled();
  });

  it("routes only the bare Store v5 pipeline-summary endpoint to the native sidecar", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        jsonResponse({
          workspace_id: "workspace-a",
          results: [],
          total: 0,
          limit: 100,
          offset: 0,
          has_more: false,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    window.electronApi = createElectronApiMock({
      getNativeSidecarInfo: vi.fn().mockResolvedValue({
        status: "running",
        host: "127.0.0.1",
        port: 43123,
        protocolVersion: "studio-sidecar-r1",
        url: "http://127.0.0.1:43123",
        pythonPluginHostConfigured: false,
      }),
    });

    await api.get("/workspaces/workspace-a/results");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:43123/api/workspaces/workspace-a/results",
      expect.any(Object),
    );
  });

  it("routes only the bare GET results summary to the native sidecar", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        jsonResponse({ workspace_id: "workspace-a", datasets: [] }),
      );
    vi.stubGlobal("fetch", fetchMock);
    window.electronApi = createElectronApiMock({
      getNativeSidecarInfo: vi.fn().mockResolvedValue({
        status: "running",
        host: "127.0.0.1",
        port: 43123,
        protocolVersion: "studio-sidecar-r1",
        url: "http://127.0.0.1:43123",
        pythonPluginHostConfigured: false,
      }),
    });

    await api.get("/workspaces/workspace-a/results/summary");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:43123/api/workspaces/workspace-a/results/summary",
      expect.any(Object),
    );
  });

  it("does not retry a native results-summary incompatibility through FastAPI", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          detail: "Workspace has no compatible native WorkspaceStore v5",
          code: "workspace_store_unavailable",
        },
        409,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    window.electronApi = createElectronApiMock({
      getNativeSidecarInfo: vi.fn().mockResolvedValue({
        status: "running",
        host: "127.0.0.1",
        port: 43123,
        protocolVersion: "studio-sidecar-r1",
        url: "http://127.0.0.1:43123",
        pythonPluginHostConfigured: false,
      }),
    });

    await expect(
      api.get("/workspaces/workspace-a/results/summary"),
    ).rejects.toMatchObject({
      detail: "Workspace has no compatible native WorkspaceStore v5",
      status: 409,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/api/workspaces/workspace-a/results/summary",
      expect.any(Object),
    );
  });

  it("does not retry a native pipeline-summary incompatibility through FastAPI", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          detail: "Workspace has no compatible native WorkspaceStore v5",
          code: "workspace_store_unavailable",
        },
        409,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    window.electronApi = createElectronApiMock({
      getNativeSidecarInfo: vi.fn().mockResolvedValue({
        status: "running",
        host: "127.0.0.1",
        port: 43123,
        protocolVersion: "studio-sidecar-r1",
        url: "http://127.0.0.1:43123",
        pythonPluginHostConfigured: false,
      }),
    });

    await expect(
      api.get("/workspaces/workspace-a/results"),
    ).rejects.toMatchObject({
      detail: "Workspace has no compatible native WorkspaceStore v5",
      status: 409,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/api/workspaces/workspace-a/results",
      expect.any(Object),
    );
  });
});
