/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRuntimeSummary: vi.fn(),
  getConfigDiff: vi.fn(),
  getDependencies: vi.fn(),
  alignConfig: vi.fn(),
  announceBackendRestarted: vi.fn(),
  loadPostSwitchValidation: vi.fn(),
  previewRuntimeAlignment: vi.fn(),
  restartBackendForRuntimeSwitch: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    getRuntimeSummary: mocks.getRuntimeSummary,
    getConfigDiff: mocks.getConfigDiff,
    getDependencies: mocks.getDependencies,
    alignConfig: mocks.alignConfig,
  };
});

vi.mock("@/lib/pythonRuntimeSwitch", () => ({
  announceBackendRestarted: mocks.announceBackendRestarted,
  loadPostSwitchValidation: mocks.loadPostSwitchValidation,
  previewRuntimeAlignment: mocks.previewRuntimeAlignment,
  restartBackendForRuntimeSwitch: mocks.restartBackendForRuntimeSwitch,
}));

import { PythonEnvPicker } from "../PythonEnvPicker";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

interface ElectronApiMock {
  getEnvInfo: ReturnType<typeof vi.fn>;
  detectExistingEnvs: ReturnType<typeof vi.fn>;
  inspectExistingEnv: ReturnType<typeof vi.fn>;
  inspectExistingPython: ReturnType<typeof vi.fn>;
  applyExistingEnv: ReturnType<typeof vi.fn>;
  applyExistingPython: ReturnType<typeof vi.fn>;
  selectPythonExe: ReturnType<typeof vi.fn>;
  selectFolder: ReturnType<typeof vi.fn>;
  startEnvSetup: ReturnType<typeof vi.fn>;
  onEnvSetupProgress: ReturnType<typeof vi.fn>;
  restartBackend: ReturnType<typeof vi.fn>;
  platform: string;
}

function createElectronApi(): ElectronApiMock {
  return {
    getEnvInfo: vi.fn().mockResolvedValue({
      status: "ready",
      envDir: "C:\\envs\\configured",
      pythonPath: "C:\\envs\\configured\\python.exe",
      sitePackages: null,
      pythonVersion: "3.11.9",
      isCustom: true,
    }),
    detectExistingEnvs: vi.fn().mockResolvedValue([]),
    inspectExistingEnv: vi.fn(),
    inspectExistingPython: vi.fn(),
    applyExistingEnv: vi.fn(),
    applyExistingPython: vi.fn(),
    selectPythonExe: vi.fn(),
    selectFolder: vi.fn(),
    startEnvSetup: vi.fn(),
    onEnvSetupProgress: vi.fn(() => () => undefined),
    restartBackend: vi.fn(),
    platform: "win32",
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(assertion: () => void, timeoutMs: number = 1000): Promise<void> {
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
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  }
}

async function renderComponent(electronApi: ElectronApiMock) {
  (window as Window & { electronApi?: ElectronApiMock }).electronApi = electronApi;

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<PythonEnvPicker />);
  });

  return {
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
  delete (window as Window & { electronApi?: ElectronApiMock }).electronApi;
});

describe("PythonEnvPicker", () => {
  it("shows only the running Python path in the settings summary", async () => {
    mocks.getRuntimeSummary.mockResolvedValue({
      coherent: false,
      configured_python: "C:\\envs\\configured\\python.exe",
      running_python: "C:\\Users\\me\\AppData\\Local\\Programs\\Python\\Python313\\python.exe",
      running_prefix: "C:\\Users\\me\\AppData\\Local\\Programs\\Python\\Python313",
      runtime_kind: "custom",
      is_bundled_default: false,
      bundled_runtime_available: false,
      configured_matches_running: false,
      core_ready: true,
      missing_core_packages: [],
      missing_optional_packages: ["jax", "flax"],
      python_match: false,
      prefix_match: false,
      runtime: {
        python: "C:\\Users\\me\\AppData\\Local\\Programs\\Python\\Python313\\python.exe",
        prefix: "C:\\Users\\me\\AppData\\Local\\Programs\\Python\\Python313",
        version: "3.13.1",
      },
      venv_manager: {
        python: "C:\\envs\\configured\\python.exe",
        prefix: "C:\\envs\\configured",
      },
    });

    const view = await renderComponent(createElectronApi());

    await waitFor(() => {
      expect(view.container.textContent).toContain("Running Python");
    });

    expect(view.container.textContent).not.toContain("Configured Python");
    expect(view.container.textContent).not.toContain("Configured = Running");
    expect(view.container.textContent).not.toContain("Configured Python does not match the running backend");

    await view.unmount();
  });

  it("shows progress feedback while inspecting a selected environment", async () => {
    mocks.getRuntimeSummary.mockResolvedValue({
      coherent: true,
      configured_python: "C:\\envs\\configured\\python.exe",
      running_python: "C:\\envs\\configured\\python.exe",
      running_prefix: "C:\\envs\\configured",
      runtime_kind: "custom",
      is_bundled_default: false,
      bundled_runtime_available: false,
      configured_matches_running: true,
      core_ready: true,
      missing_core_packages: [],
      missing_optional_packages: [],
      python_match: true,
      prefix_match: true,
      runtime: {
        python: "C:\\envs\\configured\\python.exe",
        prefix: "C:\\envs\\configured",
        version: "3.11.9",
      },
      venv_manager: {
        python: "C:\\envs\\configured\\python.exe",
        prefix: "C:\\envs\\configured",
      },
    });

    const electronApi = createElectronApi();
    electronApi.detectExistingEnvs.mockResolvedValue([
      {
        path: "C:\\Python313",
        pythonPath: "C:\\Python313\\python.exe",
        pythonVersion: "3.13.9",
        hasNirs4all: false,
        hasCorePackages: false,
        envKind: "system",
        writable: true,
      },
    ]);
    const inspectDeferred = createDeferred<{
      success: boolean;
      message: string;
      info?: {
        path: string;
        pythonPath: string;
        pythonVersion: string;
        hasNirs4all: boolean;
        hasCorePackages: boolean;
        envKind: "system";
        writable: boolean;
        missingCorePackages: string[];
        missingOptionalPackages: string[];
        profileAlignmentGuess: null;
      };
    }>();
    electronApi.inspectExistingEnv.mockReturnValue(inspectDeferred.promise);

    const view = await renderComponent(electronApi);

    await waitFor(() => {
      expect(view.container.textContent).toContain("settings.pythonEnv.change");
    });

    const changeButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("settings.pythonEnv.change"),
    );
    expect(changeButton).toBeTruthy();

    await act(async () => {
      changeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await waitFor(() => {
      expect(document.body.textContent).toContain("Python 3.13.9");
    });

    const envButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Python 3.13.9"),
    );
    expect(envButton).toBeTruthy();

    await act(async () => {
      envButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await waitFor(() => {
      expect(document.body.textContent).toContain("Inspecting environment");
      expect(document.body.textContent).toContain(
        "Reading Python details, write access, and missing package information for the selected environment.",
      );
    });

    await act(async () => {
      inspectDeferred.resolve({
        success: true,
        message: "",
        info: {
          path: "C:\\Python313",
          pythonPath: "C:\\Python313\\python.exe",
          pythonVersion: "3.13.9",
          hasNirs4all: false,
          hasCorePackages: false,
          envKind: "system",
          writable: true,
          missingCorePackages: ["nirs4all"],
          missingOptionalPackages: [],
          profileAlignmentGuess: null,
        },
      });
      await Promise.resolve();
    });

    await view.unmount();
  });

  it("restarts the backend and closes the review dialog after a successful runtime alignment", async () => {
    const initialRuntimeSummary = {
      coherent: true,
      configured_python: "C:\\envs\\configured\\python.exe",
      running_python: "C:\\envs\\configured\\python.exe",
      running_prefix: "C:\\envs\\configured",
      runtime_kind: "custom",
      is_bundled_default: false,
      bundled_runtime_available: false,
      configured_matches_running: true,
      core_ready: true,
      missing_core_packages: [],
      missing_optional_packages: [],
      python_match: true,
      prefix_match: true,
      runtime: {
        python: "C:\\envs\\configured\\python.exe",
        prefix: "C:\\envs\\configured",
        version: "3.11.9",
      },
      venv_manager: {
        python: "C:\\envs\\configured\\python.exe",
        prefix: "C:\\envs\\configured",
      },
    };
    const runtimeSummary = {
      coherent: true,
      configured_python: "C:\\Python313\\python.exe",
      running_python: "C:\\Python313\\python.exe",
      running_prefix: "C:\\Python313",
      runtime_kind: "custom",
      is_bundled_default: false,
      bundled_runtime_available: false,
      configured_matches_running: true,
      core_ready: true,
      missing_core_packages: [],
      missing_optional_packages: ["tabpfn"],
      python_match: true,
      prefix_match: true,
      runtime: {
        python: "C:\\Python313\\python.exe",
        prefix: "C:\\Python313",
        version: "3.13.9",
      },
      venv_manager: {
        python: "C:\\Python313\\python.exe",
        prefix: "C:\\Python313",
      },
    };
    const validation = {
      runtimeSummary,
      gpuInfo: {
        has_cuda: true,
        has_metal: false,
        cuda_version: "12.4",
        gpu_name: "RTX 4090",
        driver_version: "591.86",
        torch_cuda_available: false,
        torch_version: "2.6.0+cpu",
        detection_source: "windows-wmi",
        recommended_profiles: ["gpu-cuda-torch", "cpu"],
      },
      config: {
        schema_version: "1.2",
        app_version: "0.6.0",
        nirs4all: "0.9.1",
        fetched_from: "bundled",
        fetched_at: "2026-04-18T08:00:00",
        profiles: [
          {
            id: "gpu-cuda-torch",
            label: "GPU CUDA",
            description: "CUDA profile",
            platforms: ["win32"],
            packages: {
              nirs4all: { min: ">=0.9.1", recommended: "0.9.1" },
            },
          },
        ],
        optional: [
          {
            name: "tabpfn",
            min: ">=2.0.0",
            recommended: "2.0.3",
            description: "TabPFN",
            category: "models",
            note: null,
            show_when_profile_managed: false,
            default_install: true,
          },
        ],
      },
      visibleOptionalPackages: [
        {
          name: "tabpfn",
          min: ">=2.0.0",
          recommended: "2.0.3",
          description: "TabPFN",
          category: "models",
          note: null,
          show_when_profile_managed: false,
          default_install: true,
        },
      ],
      selectedProfile: "gpu-cuda-torch",
      selectedExtras: ["tabpfn"],
      alignmentPreview: {
        success: true,
        message: "Dry run: would install/upgrade 2 packages",
        installed: ["nirs4all==0.9.1", "tabpfn==2.0.3"],
        upgraded: [],
        failed: [],
        dry_run: true,
        requires_restart: false,
      },
    };

    mocks.getRuntimeSummary.mockResolvedValue(initialRuntimeSummary);
    mocks.getConfigDiff.mockResolvedValue({
      profile: "gpu-cuda-torch",
      profile_label: "GPU CUDA",
      packages: [
        {
          name: "nirs4all",
          installed_version: null,
          recommended_version: "nirs4all==0.9.1",
          latest_version: null,
          status: "missing",
          action: "install",
        },
      ],
      aligned_count: 0,
      misaligned_count: 0,
      missing_count: 1,
      is_aligned: false,
      checked_at: "2026-04-18T08:00:00",
    });
    mocks.getDependencies.mockResolvedValue({
      categories: [
        {
          id: "models",
          name: "Models",
          description: "Optional models",
          packages: [
            {
              name: "tabpfn",
              category: "models",
              category_name: "Models",
              description: "TabPFN",
              min_version: ">=2.0.0",
              recommended_version: "2.0.3",
              installed_version: null,
              latest_version: null,
              is_installed: false,
              is_outdated: false,
              is_below_recommended: false,
              is_above_recommended: false,
              can_update: false,
              default_install: true,
              managed_by_profile: false,
            },
          ],
          installed_count: 0,
          total_count: 1,
        },
      ],
      runtime_valid: true,
      runtime_path: "C:\\Python313",
      venv_valid: true,
      venv_path: "C:\\Python313",
      nirs4all_installed: false,
      nirs4all_version: null,
      total_installed: 0,
      total_packages: 1,
      cached_at: "2026-04-18T08:00:00",
    });
    mocks.previewRuntimeAlignment.mockResolvedValue(validation.alignmentPreview);
    mocks.restartBackendForRuntimeSwitch.mockResolvedValue(validation);
    mocks.alignConfig.mockResolvedValue({
      success: true,
      message: "Installed 2 packages",
      installed: ["nirs4all==0.9.1", "tabpfn==2.0.3"],
      upgraded: [],
      failed: [],
      dry_run: false,
      requires_restart: true,
    });
    mocks.loadPostSwitchValidation.mockResolvedValue(validation);

    const electronApi = createElectronApi();
    electronApi.detectExistingEnvs.mockResolvedValue([
      {
        path: "C:\\Python313",
        pythonPath: "C:\\Python313\\python.exe",
        pythonVersion: "3.13.9",
        hasNirs4all: true,
        hasCorePackages: true,
        envKind: "system",
        writable: true,
      },
    ]);
    electronApi.inspectExistingEnv.mockResolvedValue({
      success: true,
      message: "",
      info: {
        path: "C:\\Python313",
        pythonPath: "C:\\Python313\\python.exe",
        pythonVersion: "3.13.9",
        hasNirs4all: true,
        hasCorePackages: true,
        envKind: "system",
        writable: true,
        missingCorePackages: [],
        missingOptionalPackages: ["tabpfn"],
        profileAlignmentGuess: null,
      },
    });
    electronApi.applyExistingPython.mockResolvedValue({
      success: true,
      message: "Using Python 3.13.9 from C:\\Python313\\python.exe",
      info: {
        path: "C:\\Python313",
        pythonPath: "C:\\Python313\\python.exe",
        pythonVersion: "3.13.9",
        hasNirs4all: true,
        hasCorePackages: true,
        envKind: "system",
        writable: true,
        missingCorePackages: [],
        missingOptionalPackages: ["tabpfn"],
        profileAlignmentGuess: null,
      },
    });
    electronApi.restartBackend.mockResolvedValue({ success: true, port: 39857 });

    const view = await renderComponent(electronApi);

    await waitFor(() => {
      expect(view.container.textContent).toContain("settings.pythonEnv.change");
    });

    const changeButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("settings.pythonEnv.change"),
    );
    expect(changeButton).toBeTruthy();

    await act(async () => {
      changeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await waitFor(() => {
      expect(document.body.textContent).toContain("Python 3.13.9");
    });

    const envButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Python 3.13.9"),
    );
    expect(envButton).toBeTruthy();

    await act(async () => {
      envButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await waitFor(() => {
      expect(document.body.textContent).toContain("Use as-is");
    });

    const useAsIsButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Use as-is"),
    );
    expect(useAsIsButton).toBeTruthy();

    await act(async () => {
      useAsIsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // After switch, the Review dialog no longer auto-opens — the user must
    // click the "Review packages" button in the env card explicitly.
    await waitFor(() => {
      expect(electronApi.applyExistingPython).toHaveBeenCalled();
      expect(document.body.textContent).not.toContain("Review Runtime After Switch");
    });

    const reviewButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.trim() === "Review packages",
    );
    expect(reviewButton).toBeTruthy();

    await act(async () => {
      reviewButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await waitFor(() => {
      expect(document.body.textContent).toContain("Review Runtime After Switch");
    });

    const alignButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Align runtime"),
    );
    expect(alignButton).toBeTruthy();

    await act(async () => {
      alignButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await waitFor(() => {
      expect(electronApi.restartBackend).toHaveBeenCalledWith({ skipEnsure: true });
      expect(document.body.textContent).not.toContain("Review Runtime After Switch");
    });

    expect(mocks.announceBackendRestarted).toHaveBeenCalledTimes(1);

    await view.unmount();
  });
});
