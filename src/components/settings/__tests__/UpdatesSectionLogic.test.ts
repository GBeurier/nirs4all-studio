import { describe, expect, it } from "vitest";
import type { GPUDetectionResponse } from "@/api/config";
import type { RuntimeInfo, RuntimeStatus, UpdateStatus } from "@/api/updates";
import type { RuntimeSummaryResponse } from "@/types/settings";
import {
  canApplyWebappUpdateInPlace,
  getCurrentRuntime,
  getGpuDisplay,
  getInstallerUrl,
  getNirs4allUpdateRowState,
  getRuntimeExecutablePath,
  getTorchRuntimeDisplay,
  getUpdateAvailability,
  getWebappDialogCopy,
  getWebappUpdateRowState,
} from "../UpdatesSectionLogic";

const runtime: RuntimeInfo = {
  path: "/opt/nirs4all/runtime",
  exists: true,
  is_valid: true,
  python_executable: "/opt/nirs4all/runtime/bin/python",
  python_version: "3.11.9",
  pip_version: "24.0",
  created_at: null,
  last_updated: null,
  size_bytes: 1024,
};

type StatusOverrides = Omit<Partial<UpdateStatus>, "webapp" | "nirs4all" | "runtime"> & {
  nirs4all?: Partial<UpdateStatus["nirs4all"]>;
  runtime?: RuntimeInfo;
  webapp?: Partial<UpdateStatus["webapp"]>;
};

function createStatus(overrides: StatusOverrides = {}): UpdateStatus {
  const { nirs4all, runtime: runtimeOverride, webapp, ...statusOverrides } = overrides;

  return {
    webapp: {
      current_version: "1.0.0",
      latest_version: "1.0.0",
      update_available: false,
      release_url: "https://example.test/releases/latest",
      release_notes: null,
      published_at: null,
      download_size_bytes: null,
      download_url: null,
      asset_name: null,
      checksum_sha256: null,
      is_prerelease: false,
      ...webapp,
    },
    nirs4all: {
      current_version: "0.9.0",
      latest_version: "0.9.0",
      update_available: false,
      pypi_url: null,
      release_notes: null,
      requires_restart: false,
      ...nirs4all,
    },
    runtime: runtimeOverride ?? runtime,
    last_check: null,
    check_interval_hours: 24,
    ...statusOverrides,
  };
}

function createGpu(overrides: Partial<GPUDetectionResponse> = {}): GPUDetectionResponse {
  return {
    has_cuda: false,
    has_metal: false,
    cuda_version: null,
    gpu_name: null,
    driver_version: null,
    torch_cuda_available: false,
    torch_version: null,
    detection_source: null,
    recommended_profiles: [],
    ...overrides,
  };
}

function createRuntimeSummary(overrides: Partial<RuntimeSummaryResponse> = {}): RuntimeSummaryResponse {
  return {
    coherent: true,
    configured_python: "/configured/python",
    running_python: "/running/python",
    running_prefix: "/running",
    runtime_kind: "managed",
    is_bundled_default: false,
    bundled_runtime_available: true,
    configured_matches_running: true,
    core_ready: true,
    missing_core_packages: [],
    missing_optional_packages: [],
    python_match: true,
    prefix_match: true,
    runtime: {
      python: "/running/python",
      prefix: "/running",
      version: "3.11.9",
    },
    venv_manager: {
      python: "/configured/python",
      prefix: "/configured",
    },
    ...overrides,
  };
}

describe("UpdatesSectionLogic", () => {
  it("summarizes update availability and installer capability", () => {
    const status = createStatus({
      webapp: { update_available: true, latest_version: "1.1.0" },
      nirs4all: { update_available: true, latest_version: "0.10.0" },
    });

    expect(getUpdateAvailability(status)).toEqual({
      hasWebappUpdate: true,
      hasNirs4allUpdate: true,
      hasAnyUpdate: true,
      updateCount: 2,
    });
    expect(getInstallerUrl(status)).toBe("https://example.test/releases/latest");
    expect(getInstallerUrl(createStatus({ webapp: { installer_download_url: "https://example.test/app.exe" } }))).toBe(
      "https://example.test/app.exe",
    );
    expect(canApplyWebappUpdateInPlace(createStatus())).toBe(true);
    expect(
      canApplyWebappUpdateInPlace(
        createStatus({
          update_capability: {
            can_apply_in_place: false,
            channel: "installer",
            reason: "packaged installer",
            install_kind: "deb",
          },
        }),
      ),
    ).toBe(false);
  });

  it("keeps webapp row actions mutually exclusive", () => {
    const updateAvailable = createStatus({
      webapp: { update_available: true, latest_version: "1.1.0", is_prerelease: true },
    });
    const installerOnly = createStatus({
      webapp: { update_available: true, latest_version: "1.1.0" },
      update_capability: {
        can_apply_in_place: false,
        channel: "installer",
        reason: "native package",
        install_kind: "appimage",
      },
    });
    const idleDownload = { isDownloading: false, downloadProgress: 0, readyToApply: false };

    expect(
      getWebappUpdateRowState({
        status: updateAvailable,
        stagedUpdate: undefined,
        download: { isDownloading: true, downloadProgress: 42.6, readyToApply: false },
      }),
    ).toMatchObject({
      action: "downloading",
      downloadProgressPercent: 43,
      isPrerelease: true,
    });

    expect(
      getWebappUpdateRowState({
        status: createStatus(),
        stagedUpdate: { has_staged_update: true, version: "1.0.1" },
        download: idleDownload,
      }),
    ).toMatchObject({
      action: "apply",
      showTargetVersion: true,
      targetVersion: "1.0.1",
    });

    expect(
      getWebappUpdateRowState({
        status: updateAvailable,
        stagedUpdate: undefined,
        download: idleDownload,
      }).action,
    ).toBe("update");
    expect(
      getWebappUpdateRowState({
        status: installerOnly,
        stagedUpdate: undefined,
        download: idleDownload,
      }).action,
    ).toBe("installer");
    expect(
      getWebappUpdateRowState({
        status: createStatus(),
        stagedUpdate: undefined,
        download: idleDownload,
      }).action,
    ).toBe("up-to-date");
  });

  it("preserves the installer-only stale staged-update state with no CTA", () => {
    const state = getWebappUpdateRowState({
      status: createStatus({
        update_capability: {
          can_apply_in_place: false,
          channel: "installer",
          reason: "native package",
          install_kind: "dmg",
        },
      }),
      stagedUpdate: { has_staged_update: true, version: "1.0.1" },
      download: { isDownloading: false, downloadProgress: 0, readyToApply: false },
    });

    expect(state.action).toBeNull();
    expect(state.showTargetVersion).toBe(true);
    expect(state.targetVersion).toBe("1.0.1");
  });

  it("describes the nirs4all row action and disabled state", () => {
    expect(
      getNirs4allUpdateRowState(
        createStatus({ nirs4all: { update_available: true, latest_version: "0.10.0" } }),
        true,
      ),
    ).toEqual({
      action: "update",
      currentVersion: "0.9.0",
      isActionDisabled: true,
      latestVersion: "0.10.0",
      showTargetVersion: true,
    });
    expect(getNirs4allUpdateRowState(createStatus(), false).action).toBe("up-to-date");
    expect(getNirs4allUpdateRowState(createStatus({ nirs4all: { current_version: null } }), false).action).toBe(
      "install",
    );
  });

  it("derives runtime and GPU labels outside the component", () => {
    const fallbackRuntime = {
      ...runtime,
      path: "/fallback",
      python_executable: "/fallback/bin/python",
    };
    const runtimeStatus: RuntimeStatus = {
      runtime,
      venv: fallbackRuntime,
      packages: [],
      nirs4all_version: "0.9.0",
    };

    expect(getCurrentRuntime(runtimeStatus)).toBe(runtime);
    expect(getCurrentRuntime({ venv: fallbackRuntime })).toBe(fallbackRuntime);
    expect(getRuntimeExecutablePath(createRuntimeSummary(), runtime)).toBe("/running/python");
    expect(getRuntimeExecutablePath(null, runtime)).toBe("/opt/nirs4all/runtime/bin/python");
    expect(getRuntimeExecutablePath(null, null)).toBe("Unavailable");

    expect(getGpuDisplay(undefined, true)).toEqual({ label: "Detecting...", muted: true });
    expect(getGpuDisplay(createGpu({ has_cuda: true, gpu_name: "RTX 4090", cuda_version: "12.4" }), false)).toEqual({
      label: "RTX 4090 (CUDA 12.4)",
      muted: false,
    });
    expect(getGpuDisplay(createGpu({ has_cuda: true, driver_version: "550.54" }), false)).toEqual({
      label: "NVIDIA GPU (Driver 550.54)",
      muted: false,
    });
    expect(getGpuDisplay(createGpu({ has_metal: true }), false)).toEqual({ label: "Apple Metal", muted: false });
    expect(getGpuDisplay(createGpu(), false)).toEqual({ label: "CPU only", muted: true });
    expect(getTorchRuntimeDisplay(undefined)).toBeNull();
    expect(getTorchRuntimeDisplay(createGpu())).toEqual({ label: "Not installed", muted: true });
    expect(getTorchRuntimeDisplay(createGpu({ torch_version: "2.7.0", torch_cuda_available: true }))).toEqual({
      label: "2.7.0 (CUDA ready)",
      muted: false,
    });
  });

  it("derives webapp dialog copy from download state", () => {
    expect(
      getWebappDialogCopy({
        download: {
          downloadMessage: "Downloading archive",
          isDownloading: true,
          readyToApply: true,
          stagedVersion: "1.1.0",
        },
        latestVersion: "1.2.0",
      }),
    ).toEqual({
      title: "Update Ready to Apply",
      description: "Version 1.1.0 is ready to install",
    });
    expect(
      getWebappDialogCopy({
        download: {
          downloadMessage: "",
          isDownloading: true,
          readyToApply: false,
        },
        latestVersion: "1.2.0",
      }),
    ).toEqual({
      title: "Downloading Update...",
      description: "Downloading...",
    });
    expect(
      getWebappDialogCopy({
        download: {
          downloadMessage: "",
          isDownloading: false,
          readyToApply: false,
        },
        latestVersion: "1.2.0",
      }),
    ).toEqual({
      title: "Webapp Update Available",
      description: "Version 1.2.0 is available",
    });
  });
});
