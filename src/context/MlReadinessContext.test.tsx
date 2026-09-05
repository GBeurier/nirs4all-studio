/**
 * @vitest-environment jsdom
 */

import { act, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  prefetchDatasetsList: vi.fn(),
}));

vi.mock("@/api/transport", () => ({
  api: {
    get: mocks.apiGet,
  },
}));

vi.mock("@/hooks/useDatasetQueries", () => ({
  prefetchDatasetsList: mocks.prefetchDatasetsList,
  datasetQueryKeys: {
    all: ["datasets"],
    list: () => ["datasets", "list"],
    detail: (id: string | null | undefined) => ["datasets", "detail", id],
    preview: (id: string | null | undefined, n: number) => [
      "datasets",
      "preview",
      id,
      n,
    ],
    linkedWorkspaces: () => ["workspaces", "linked"],
    scores: (wsId: string | null | undefined) => ["workspaces", wsId, "scores"],
  },
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface MlStatusPayload {
  core_ready: boolean;
  ml_ready: boolean;
  ml_loading: boolean;
  ml_error: string | null;
  workspace_ready?: boolean;
}

type RendererElectronApi = NonNullable<Window["electronApi"]>;
type MlReadyListener = (info: {
  ready: boolean;
  error?: string;
  workspaceReady?: boolean;
}) => void;

type ElectronApiMock = RendererElectronApi;

function createElectronApiMock(
  overrides: Partial<ElectronApiMock> = {},
): ElectronApiMock {
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
    preselectRendererTransport: vi.fn(),
    preselectWorkspaceRunDetail: vi.fn(),
    getNativeSidecarInfo: vi.fn().mockResolvedValue({
      status: "disabled",
      host: null,
      port: null,
      protocolVersion: null,
      url: null,
      pythonPluginHostConfigured: false,
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
    onMlReady: vi.fn(() => () => undefined),
    ...overrides,
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(
  assertion: () => void,
  timeoutMs: number = 1000,
): Promise<void> {
  const start = Date.now();
  while (true) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - start >= timeoutMs) {
        throw error;
      }
      await act(async () => {
        await Promise.resolve();
      });
    }
  }
}

async function importProviderModule() {
  const providerModule = await import("./MlReadinessContext");
  const readinessModule = await import("./useMlReadiness");
  return {
    MlReadinessProvider: providerModule.MlReadinessProvider,
    useMlReadiness: readinessModule.useMlReadiness,
  };
}

async function renderProvider(electronApi: ElectronApiMock | undefined) {
  vi.resetModules();
  window.electronApi = electronApi;

  const { MlReadinessProvider, useMlReadiness } = await importProviderModule();

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = createQueryClient();
  const result: { current?: ReturnType<typeof useMlReadiness> } = {};

  function ReadinessProbe() {
    result.current = useMlReadiness();
    return null;
  }

  function TestTree({ children }: { children?: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MlReadinessProvider>{children}</MlReadinessProvider>
      </QueryClientProvider>
    );
  }

  await act(async () => {
    root.render(
      <TestTree>
        <ReadinessProbe />
      </TestTree>,
    );
  });

  return {
    client,
    result,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      client.clear();
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  mocks.apiGet.mockReset();
  delete window.electronApi;
});

describe("MlReadinessProvider", () => {
  it("reports the native control plane ready without activating Python", async () => {
    mocks.apiGet.mockResolvedValue({
      core_ready: true,
      ml_ready: false,
      native_prediction_ready: true,
      native_training_ready: true,
      workspace_ready: true,
    });
    const electronApi = createElectronApiMock();
    const view = await renderProvider(electronApi);

    await waitFor(() => {
      expect(view.result.current?.controlReady).toBe(true);
      expect(view.result.current?.coreReady).toBe(true);
      expect(view.result.current?.scientificStatus).toBe("stopped");
      expect(view.result.current?.scientificRequested).toBe(false);
      expect(view.result.current?.mlLoading).toBe(false);
      expect(view.result.current?.mlReady).toBe(false);
      expect(view.result.current?.nativePredictionReady).toBe(true);
      expect(view.result.current?.nativeTrainingReady).toBe(true);
      expect(view.result.current?.workspaceReady).toBe(true);
    });
    expect(mocks.apiGet).toHaveBeenCalledWith("/system/readiness");
    expect(electronApi).not.toHaveProperty("getScientificPluginInfo");
    expect(electronApi).not.toHaveProperty("getScientificReadiness");

    await view.unmount();
  });

  it.each([false, true])("clears capabilities after connection loss (general host ready: %s)", async (mlReady) => {
    vi.useFakeTimers();
    mocks.apiGet.mockResolvedValueOnce({ native_prediction_ready: true, ml_ready: mlReady })
      .mockRejectedValue(new Error("connection lost"));
    const view = await renderProvider(createElectronApiMock());
    expect(view.result.current?.nativePredictionReady).toBe(true);
    expect(view.result.current?.mlReady).toBe(mlReady);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(view.result.current?.nativePredictionReady).toBe(false);
    expect(view.result.current?.mlReady).toBe(false);
    await view.unmount();
  });

  it("preserves the transitional web startup latch without inventing native capabilities", async () => {
    vi.useFakeTimers();
    mocks.apiGet.mockResolvedValueOnce({ core_ready: true, ml_ready: true, workspace_ready: false })
      .mockResolvedValue({ core_ready: false, ml_ready: false, ml_loading: true, workspace_ready: false });
    const view = await renderProvider(undefined);
    expect(view.result.current?.mlReady).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(view.result.current?.mlReady).toBe(true);
    expect(view.result.current?.mlLoading).toBe(false);
    expect(view.result.current?.nativePredictionReady).toBe(false);
    expect(view.result.current?.nativeTrainingReady).toBe(false);
    await view.unmount();
  });

  it("tracks the general library readiness through Rust with no removed preload methods", async () => {
    vi.useFakeTimers();

    mocks.apiGet
      .mockResolvedValueOnce({
        core_ready: true,
        ml_ready: true,
        ml_loading: false,
        ml_error: null,
        workspace_ready: false,
      })
      .mockResolvedValueOnce({
        core_ready: false,
        ml_ready: false,
        ml_loading: true,
        ml_error: null,
        workspace_ready: false,
      })
      .mockResolvedValueOnce({
        core_ready: true,
        ml_ready: true,
        ml_loading: false,
        ml_error: null,
        workspace_ready: true,
      });

    const view = await renderProvider(createElectronApiMock());

    await waitFor(() => {
      expect(view.result.current?.coreReady).toBe(true);
      expect(view.result.current?.mlReady).toBe(true);
      expect(view.result.current?.workspaceReady).toBe(false);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(view.result.current?.coreReady).toBe(true);
    expect(view.result.current?.mlReady).toBe(false);
    expect(view.result.current?.mlLoading).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    await waitFor(() => {
      expect(view.result.current?.workspaceReady).toBe(true);
    });
    expect(mocks.apiGet).toHaveBeenCalledTimes(3);
    expect(view.result.current?.mlReady).toBe(true);
    expect(view.result.current?.scientificStatus).toBe("running");

    await view.unmount();
  });

  it("cancels stale startup polls when workspace readiness arrives from IPC first", async () => {
    vi.useFakeTimers();

    const firstPoll = deferred<MlStatusPayload>();
    let mlReadyListener: MlReadyListener | null = null;

    mocks.apiGet.mockReturnValueOnce(firstPoll.promise).mockResolvedValue({
      core_ready: true, ml_ready: true, ml_loading: false, ml_error: null, workspace_ready: true,
    });

    const view = await renderProvider(
      createElectronApiMock({
        onMlReady: (cb) => {
          mlReadyListener = cb;
          return () => {
            if (mlReadyListener === cb) {
              mlReadyListener = null;
            }
          };
        },
        onBackendStatusChanged: () => () => undefined,
      }),
    );

    await act(async () => {
      mlReadyListener?.({ ready: true, workspaceReady: true });
    });

    await waitFor(() => {
      expect(view.result.current?.mlReady).toBe(true);
      expect(view.result.current?.workspaceReady).toBe(true);
    });

    await act(async () => {
      firstPoll.resolve({
        core_ready: false,
        ml_ready: false,
        ml_loading: true,
        ml_error: null,
        workspace_ready: false,
      });
      await Promise.resolve();
    });

    // Assert before any fresh poll can mask a stale response regression.
    expect(view.result.current?.mlReady).toBe(true);
    expect(view.result.current?.workspaceReady).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(mocks.apiGet).toHaveBeenCalledTimes(6);
    expect(view.result.current?.coreReady).toBe(true);
    expect(view.result.current?.mlReady).toBe(true);
    expect(view.result.current?.workspaceReady).toBe(true);

    await view.unmount();
  });
});
