export type StartupStepState = "done" | "loading" | "waiting" | "error";

export type StartupBadgeIconKind = "loading" | "error";

export interface StartupTranslationText {
  key: string;
  defaultValue: string;
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
            defaultValue: "Startup issue",
          }
        : {
            key: "layout.backendStartup.badge",
            defaultValue: "Starting Studio",
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
      defaultValue: "Connecting to control plane...",
    };
  }
  if (mlError) {
    return {
      key: "layout.backendStartup.errorTitle",
      defaultValue: "Studio could not start",
    };
  }
  if (!mlReady) {
    return {
      key: "layout.backendStartup.loadingTitle",
      defaultValue: "Starting analysis engine...",
    };
  }
  return {
    key: "layout.backendStartup.workspaceTitle",
    defaultValue: "Loading workspace...",
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
      defaultValue:
        "Studio is still starting. Please wait.",
      error: null,
    };
  }
  if (mlError) {
    return {
      key: "layout.backendStartup.errorDescription",
      defaultValue: "Studio could not start.",
      error: mlError,
    };
  }
  if (!mlReady) {
    return {
      key: "layout.backendStartup.loadingDescription",
      defaultValue:
        "nirs4all and its ML dependencies are initializing in the background. Heavy analysis features will unlock automatically.",
      error: null,
    };
  }
  return {
    key: "layout.backendStartup.workspaceDescription",
    defaultValue:
      "Opening your workspace. Your datasets and results will appear when loading finishes.",
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
        defaultValue: "Control plane",
      },
      detail: state.coreReady
        ? {
            key: "layout.backendStartup.apiReady",
            defaultValue: "Analysis engine ready",
          }
        : {
            key: "layout.backendStartup.apiLoading",
            defaultValue: "Starting analysis engine",
          },
      state: state.coreReady ? "done" : "loading",
    },
    {
      label: {
        key: "layout.backendStartup.mlLabel",
        defaultValue: "ML Engine",
      },
      detail: state.mlError
        ? {
            key: "layout.backendStartup.mlError",
            defaultValue: "Initialization failed",
          }
        : state.mlReady
          ? {
              key: "layout.backendStartup.mlReady",
              defaultValue: "Dependencies loaded",
            }
          : state.coreReady
            ? {
                key: "layout.backendStartup.mlLoading",
                defaultValue: "Importing nirs4all and sklearn",
              }
            : {
                key: "layout.backendStartup.mlWaiting",
                defaultValue: "Waiting for API",
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
        defaultValue: "Workspace",
      },
      detail: state.mlError
        ? {
            key: "layout.backendStartup.workspaceBlocked",
            defaultValue: "Waiting for the analysis engine",
          }
        : workspaceDone
          ? {
              key: "layout.backendStartup.workspaceReady",
              defaultValue: "Ready",
            }
          : state.mlReady
            ? {
                key: "layout.backendStartup.workspaceLoading",
                defaultValue: "Loading datasets and run state",
              }
            : {
                key: "layout.backendStartup.workspaceWaiting",
                defaultValue: "Queued behind ML startup",
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
