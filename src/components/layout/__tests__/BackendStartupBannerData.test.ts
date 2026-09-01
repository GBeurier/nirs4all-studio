import { describe, expect, it } from "vitest";

import {
  buildBackendStartupBannerReadModel,
  canSettleStartupBanner,
  type BackendStartupBannerState,
} from "../BackendStartupBannerData";

function startupState(
  overrides: Partial<BackendStartupBannerState> = {},
): BackendStartupBannerState {
  return {
    coreReady: false,
    scientificRequested: true,
    mlReady: false,
    workspaceReady: false,
    datasetsPrimed: false,
    mlError: null,
    fetchingDatasets: 0,
    fetchingWorkspaces: 0,
    ...overrides,
  };
}

describe("BackendStartupBannerData", () => {
  it("builds the connecting read model while the API is unavailable", () => {
    const model = buildBackendStartupBannerReadModel(startupState());

    expect(model).toMatchObject({
      workspacePhase: true,
      workspaceDone: false,
      canSettle: false,
      title: {
        key: "layout.backendStartup.connectingTitle",
        defaultValue: "Connecting to control plane...",
      },
      description: {
        key: "layout.backendStartup.connectingDescription",
        error: null,
      },
      progressValue: 18,
      badge: {
        label: {
          key: "layout.backendStartup.badge",
          defaultValue: "Backend loading",
        },
        iconKind: "loading",
      },
    });
    expect(model.steps.map((step) => [step.label.defaultValue, step.state])).toEqual([
      ["Control plane", "loading"],
      ["ML Engine", "waiting"],
      ["Workspace", "waiting"],
    ]);
  });

  it("builds the ML loading read model after the API connects", () => {
    const model = buildBackendStartupBannerReadModel(
      startupState({
        coreReady: true,
      }),
    );

    expect(model.title).toEqual({
      key: "layout.backendStartup.loadingTitle",
      defaultValue: "Loading analysis backend...",
    });
    expect(model.description).toMatchObject({
      key: "layout.backendStartup.loadingDescription",
      error: null,
    });
    expect(model.progressValue).toBe(52);
    expect(model.steps.map((step) => step.state)).toEqual(["done", "loading", "waiting"]);
    expect(model.steps[1].detail).toEqual({
      key: "layout.backendStartup.mlLoading",
      defaultValue: "Importing nirs4all and sklearn",
    });
  });

  it("keeps the banner unsettled while workspace queries are still fetching", () => {
    const state = startupState({
      coreReady: true,
      mlReady: true,
      workspaceReady: true,
      datasetsPrimed: true,
      fetchingDatasets: 1,
    });
    const model = buildBackendStartupBannerReadModel(state);

    expect(canSettleStartupBanner(state)).toBe(false);
    expect(model).toMatchObject({
      workspacePhase: true,
      workspaceDone: false,
      canSettle: false,
      progressValue: 84,
    });
    expect(model.title).toEqual({
      key: "layout.backendStartup.workspaceTitle",
      defaultValue: "Loading workspace...",
    });
    expect(model.steps[2]).toMatchObject({
      detail: {
        key: "layout.backendStartup.workspaceLoading",
        defaultValue: "Loading datasets and run state",
      },
      state: "loading",
    });
  });

  it("marks startup as settle eligible when workspace and cache work is quiet", () => {
    const state = startupState({
      coreReady: true,
      mlReady: true,
      workspaceReady: true,
      datasetsPrimed: true,
    });
    const model = buildBackendStartupBannerReadModel(state);

    expect(canSettleStartupBanner(state)).toBe(true);
    expect(model).toMatchObject({
      workspacePhase: false,
      workspaceDone: true,
      canSettle: true,
      progressValue: 100,
    });
    expect(model.steps.map((step) => step.state)).toEqual(["done", "done", "done"]);
    expect(model.steps[2].detail).toEqual({
      key: "layout.backendStartup.workspaceReady",
      defaultValue: "Ready",
    });
  });

  it("builds the ML error read model with the raw error description selected", () => {
    const model = buildBackendStartupBannerReadModel(
      startupState({
        coreReady: true,
        mlError: "Import failed",
      }),
    );

    expect(model.title).toEqual({
      key: "layout.backendStartup.errorTitle",
      defaultValue: "Backend startup stalled",
    });
    expect(model.description).toEqual({
      key: "layout.backendStartup.errorDescription",
      defaultValue: "Backend startup stalled.",
      error: "Import failed",
    });
    expect(model.badge).toEqual({
      label: {
        key: "layout.backendStartup.errorBadge",
        defaultValue: "Startup issue",
      },
      iconKind: "error",
    });
    expect(model.steps.map((step) => [step.detail.key, step.state])).toEqual([
      ["layout.backendStartup.apiReady", "done"],
      ["layout.backendStartup.mlError", "error"],
      ["layout.backendStartup.workspaceBlocked", "error"],
    ]);
  });
});
