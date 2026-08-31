/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, formatApiErrorDetail, resetBackendUrl } from "./transport";
import { getConfigDiff, getRecommendedConfig } from "./config";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

type RendererElectronApi = NonNullable<Window["electronApi"]>;

function createElectronApiMock(
  overrides: Partial<RendererElectronApi> = {},
): RendererElectronApi {
  return {
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
    restartBackend: vi.fn().mockResolvedValue({ success: true }),
    onBackendStatusChanged: vi.fn(() => () => undefined),
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
  };
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
  it("retries once with a refreshed backend URL after a transient Electron fetch failure", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(
        jsonResponse({
          schema_version: "1.2",
          app_version: "0.6.0",
          nirs4all: "0.9.0",
          profiles: [],
          optional: [],
          fetched_from: "bundled",
          fetched_at: "2026-04-18T08:00:00",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const getBackendUrl = vi
      .fn()
      .mockResolvedValueOnce("http://127.0.0.1:39026")
      .mockResolvedValueOnce("http://127.0.0.1:39027");
    const getBackendInfo = vi.fn().mockResolvedValue({
      status: "running",
      port: 39027,
      url: "http://127.0.0.1:39027",
      restartCount: 3,
    });
    window.electronApi = createElectronApiMock({
      getBackendUrl,
      getBackendInfo,
    });

    const result = await getRecommendedConfig();

    expect(result.fetched_from).toBe("bundled");
    expect(getBackendUrl).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:39026/api/config/recommended",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:39027/api/config/recommended",
      expect.any(Object),
    );
    expect(getBackendInfo).toHaveBeenCalledTimes(1);
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
    window.electronApi = createElectronApiMock({ getNativeSidecarInfo });

    await api.get("/system/capabilities");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/api/system/capabilities",
      expect.any(Object),
    );
    expect(getNativeSidecarInfo).toHaveBeenCalledTimes(1);
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

  it("keeps Settings on the compatibility backend until the plugin host is configured", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ capabilities: { nirs4all: true } }));
    vi.stubGlobal("fetch", fetchMock);
    window.electronApi = createElectronApiMock({
      getBackendUrl: vi.fn().mockResolvedValue("http://127.0.0.1:39026"),
      getNativeSidecarInfo: vi.fn().mockResolvedValue({
        status: "running",
        host: "127.0.0.1",
        port: 43123,
        protocolVersion: "studio-sidecar-r1",
        url: "http://127.0.0.1:43123",
        pythonPluginHostConfigured: false,
      }),
    });

    await api.get("/system/capabilities");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:39026/api/system/capabilities",
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
});
