export type StartupStepState = "done" | "loading" | "waiting" | "error";

export type StartupBadgeIconKind = "loading" | "error";

export interface StartupTranslationText {
  key: string;
}

export interface StartupDescriptionText extends StartupTranslationText {
  error: string | null;
}

export interface StartupStepReadModel {
  label: StartupTranslationText;
  detail: StartupTranslationText;
  state: StartupStepState;
}

export interface BackendStartupBannerReadModel {
  workspacePhase: boolean;
  workspaceDone: boolean;
  canSettle: boolean;
  title: StartupTranslationText;
  description: StartupDescriptionText;
  progressValue: number;
  badge: {
    label: StartupTranslationText;
    iconKind: StartupBadgeIconKind;
  };
  steps: StartupStepReadModel[];
}

export interface BackendStartupBannerState {
  coreReady: boolean;
  scientificRequested: boolean;
  mlReady: boolean;
  workspaceReady: boolean;
  datasetsPrimed: boolean;
  mlError: string | null | undefined;
  fetchingDatasets: number;
  fetchingWorkspaces: number;
}

export function isWorkspaceStartupPhase({
  workspaceReady,
  datasetsPrimed,
  fetchingDatasets,
  fetchingWorkspaces,
}: Pick<
  BackendStartupBannerState,
  "workspaceReady" | "datasetsPrimed" | "fetchingDatasets" | "fetchingWorkspaces"
>): boolean {
  return (
    !workspaceReady ||
    !datasetsPrimed ||
    fetchingDatasets > 0 ||
    fetchingWorkspaces > 0
  );
}

export function canSettleStartupBanner(state: BackendStartupBannerState): boolean {
  if (state.coreReady && !state.scientificRequested) return true;
  return !isWorkspaceStartupPhase(state);
}

export function buildBackendStartupBannerReadModel(
  state: BackendStartupBannerState,
): BackendStartupBannerReadModel {
  const workspacePhase = state.scientificRequested && isWorkspaceStartupPhase(state);
  const workspaceDone = !workspacePhase;
  const hasMlError = Boolean(state.mlError);

  return {
    workspacePhase,
    workspaceDone,
    canSettle: canSettleStartupBanner(state),
    title: getStartupTitle(state),
    description: getStartupDescription(state),
    progressValue: getStartupProgressValue(state.coreReady, state.mlReady, workspaceDone),
    badge: {
      label: hasMlError
        ? {
            key: "layout.backendStartup.errorBadge",
          }
        : {
            key: "layout.backendStartup.badge",
          },
      iconKind: hasMlError ? "error" : "loading",
    },
    steps: getStartupSteps(state, workspaceDone),
  };
}

function getStartupTitle({
  coreReady,
  mlReady,
  mlError,
}: BackendStartupBannerState): StartupTranslationText {
  if (!coreReady) {
    return {
      key: "layout.backendStartup.connectingTitle",
    };
  }
  if (mlError) {
    return {
      key: "layout.backendStartup.errorTitle",
    };
  }
  if (!mlReady) {
    return {
      key: "layout.backendStartup.loadingTitle",
    };
  }
  return {
    key: "layout.backendStartup.workspaceTitle",
  };
}

function getStartupDescription({
  coreReady,
  mlReady,
  mlError,
}: BackendStartupBannerState): StartupDescriptionText {
  if (!coreReady) {
    return {
      key: "layout.backendStartup.connectingDescription",
      error: null,
    };
  }
  if (mlError) {
    return {
      key: "layout.backendStartup.errorDescription",
      error: mlError,
    };
  }
  if (!mlReady) {
    return {
      key: "layout.backendStartup.loadingDescription",
      error: null,
    };
  }
  return {
    key: "layout.backendStartup.workspaceDescription",
    error: null,
  };
}

function getStartupProgressValue(
  coreReady: boolean,
  mlReady: boolean,
  workspaceDone: boolean,
): number {
  if (!coreReady) return 18;
  if (!mlReady) return 52;
  return workspaceDone ? 100 : 84;
}

function getStartupSteps(
  state: BackendStartupBannerState,
  workspaceDone: boolean,
): StartupStepReadModel[] {
  return [
    {
      label: {
        key: "layout.backendStartup.apiLabel",
      },
      detail: state.coreReady
        ? {
            key: "layout.backendStartup.apiReady",
          }
        : {
            key: "layout.backendStartup.apiLoading",
          },
      state: state.coreReady ? "done" : "loading",
    },
    {
      label: {
        key: "layout.backendStartup.mlLabel",
      },
      detail: state.mlError
        ? {
            key: "layout.backendStartup.mlError",
          }
        : state.mlReady
          ? {
              key: "layout.backendStartup.mlReady",
            }
          : state.coreReady
            ? {
                key: "layout.backendStartup.mlLoading",
              }
            : {
                key: "layout.backendStartup.mlWaiting",
              },
      state: state.mlError
        ? "error"
        : state.mlReady
          ? "done"
          : state.coreReady
            ? "loading"
            : "waiting",
    },
    {
      label: {
        key: "layout.backendStartup.workspaceLabel",
      },
      detail: state.mlError
        ? {
            key: "layout.backendStartup.workspaceBlocked",
          }
        : workspaceDone
          ? {
              key: "layout.backendStartup.workspaceReady",
            }
          : state.mlReady
            ? {
                key: "layout.backendStartup.workspaceLoading",
              }
            : {
                key: "layout.backendStartup.workspaceWaiting",
              },
      state: state.mlError
        ? "error"
        : workspaceDone
          ? "done"
          : state.mlReady
            ? "loading"
            : "waiting",
    },
  ];
}
