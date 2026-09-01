/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, formatApiErrorDetail, resetBackendUrl } from "./transport";
import { getConfigDiff, getRecommendedConfig } from "./config";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
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
      target: "scientific-plugin",
      verified_store_v5: false,
      store_schema_version: null,
      reason: "legacy_manifest_or_store_absent",
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
  it("fails closed when the Electron scientific plugin cannot start", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    window.electronApi = createElectronApiMock({
      getScientificPluginUrl: vi.fn().mockRejectedValue(
        new Error("Python runtime is not configured"),
      ),
    });

    await expect(api.get("/config/recommended")).rejects.toEqual({
      detail: "Python runtime is not configured",
      status: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

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

    const getScientificPluginUrl = vi
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
      getScientificPluginUrl,
      getBackendInfo,
    });

    const result = await getRecommendedConfig();

    expect(result.fetched_from).toBe("bundled");
    expect(getScientificPluginUrl).toHaveBeenCalledTimes(2);
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

  it("keeps Settings on the compatibility backend until the plugin host is configured", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ capabilities: { nirs4all: true } }));
    vi.stubGlobal("fetch", fetchMock);
    window.electronApi = createElectronApiMock({
      getScientificPluginUrl: vi.fn().mockResolvedValue("http://127.0.0.1:39026"),
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
    await api.post("/workspaces/workspace-a/scan");

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
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:8000/api/workspaces/workspace-a/scan",
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
    await api.get("/workspaces/workspace-a/runs/enriched");
    await api.get("/workspaces/workspace-a/runs/run-a");
    await api.get("/workspaces/workspace-a/runs?refresh=true");
    await api.get("/workspaces/workspace-a/runs?refresh=false&source=parquet");
    await api.post("/workspaces/workspace-a/runs");
    await api.get("/workspaces/workspace-a/runs?unexpected=true");
    await api.get("/workspaces/workspace-a/runs?source=unified&source=parquet");
    await api.get("/workspaces/workspace-a/runs/");
    await api.post("/workspaces/workspace-a/runs/run-a/rerun");
    await api.delete("/workspaces/workspace-a/runs/run-a");

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
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:8000/api/workspaces/workspace-a/runs/enriched",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "http://127.0.0.1:8000/api/workspaces/workspace-a/runs/run-a",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "http://127.0.0.1:43123/api/workspaces/workspace-a/runs?refresh=true",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      "http://127.0.0.1:43123/api/workspaces/workspace-a/runs?refresh=false&source=parquet",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      7,
      "http://127.0.0.1:8000/api/workspaces/workspace-a/runs",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      8,
      "http://127.0.0.1:8000/api/workspaces/workspace-a/runs?unexpected=true",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      9,
      "http://127.0.0.1:8000/api/workspaces/workspace-a/runs?source=unified&source=parquet",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      10,
      "http://127.0.0.1:8000/api/workspaces/workspace-a/runs/",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      11,
      "http://127.0.0.1:8000/api/workspaces/workspace-a/runs/run-a/rerun",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      12,
      "http://127.0.0.1:8000/api/workspaces/workspace-a/runs/run-a",
      expect.objectContaining({ method: "DELETE" }),
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

  it("keeps run detail on FastAPI while owner HTTP-input materialization is unavailable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ detail: "Run 'missing-run' not found" }, 404),
    );
    const getNativeSidecarInfo = vi.fn().mockResolvedValue({
      status: "running",
      host: "127.0.0.1",
      port: 43123,
      protocolVersion: "studio-sidecar-r1",
      url: "http://127.0.0.1:43123",
      pythonPluginHostConfigured: false,
    });
    vi.stubGlobal("fetch", fetchMock);
    const preselectWorkspaceRunDetail = vi.fn();
    window.electronApi = createElectronApiMock({
      getNativeSidecarInfo,
      preselectWorkspaceRunDetail,
    });

    await expect(
      api.get("/workspaces/workspace-a/runs/missing-run"),
    ).rejects.toMatchObject({
      detail: "Run 'missing-run' not found",
      status: 404,
    });
    expect(preselectWorkspaceRunDetail).not.toHaveBeenCalled();
    expect(getNativeSidecarInfo).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/workspaces/workspace-a/runs/missing-run",
      expect.any(Object),
    );
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
    await api.get("/workspaces/workspace-a/results?run_id=run-a");
    await api.get("/workspaces/workspace-a/results?dataset=corn");
    await api.get("/workspaces/workspace-a/results?template_id=template-a");
    await api.get("/workspaces/workspace-a/results?limit=10&offset=10");
    await api.get("/workspaces/workspace-a/results/");
    await api.post("/workspaces/workspace-a/results");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:43123/api/workspaces/workspace-a/results",
      expect.any(Object),
    );
    for (let index = 2; index <= 7; index += 1) {
      expect(fetchMock.mock.calls[index - 1]?.[0]).toMatch(
        /^http:\/\/127\.0\.0\.1:8000\/api\/workspaces\/workspace-a\/results/,
      );
    }
    expect(fetchMock).toHaveBeenNthCalledWith(
      7,
      "http://127.0.0.1:8000/api/workspaces/workspace-a/results",
      expect.objectContaining({ method: "POST" }),
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
    await api.get("/workspaces/workspace-a/results/summary?n=10");
    await api.get("/workspaces/workspace-a/results/summary/");
    await api.get("/workspaces/workspace-a/results/dataset-scores");
    await api.get("/workspaces/workspace-a/results/datasets/corn/chains");
    await api.post("/workspaces/workspace-a/results/summary");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:43123/api/workspaces/workspace-a/results/summary",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:8000/api/workspaces/workspace-a/results/summary?n=10",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:8000/api/workspaces/workspace-a/results/summary/",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "http://127.0.0.1:8000/api/workspaces/workspace-a/results/dataset-scores",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "http://127.0.0.1:8000/api/workspaces/workspace-a/results/datasets/corn/chains",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      "http://127.0.0.1:8000/api/workspaces/workspace-a/results/summary",
      expect.objectContaining({ method: "POST" }),
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
