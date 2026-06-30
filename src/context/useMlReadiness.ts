import { createContext, useContext } from "react";

export interface MlReadiness {
  coreReady: boolean;
  mlReady: boolean;
  mlLoading: boolean;
  mlError: string | null;
  /**
   * True once nirs4all has finished restoring the active workspace at startup.
   * `mlReady` flips slightly earlier (as soon as the imports complete), so the
   * UI uses this flag to show a non-blocking "Loading workspace..." indicator
   * while datasets/runs/predictions endpoints are still empty.
   */
  workspaceReady: boolean;
  /**
   * True once the dataset list query has data (either hydrated from
   * localStorage at boot or fetched successfully). The backend flips
   * `workspaceReady` the moment `set_active_workspace()` returns, but React
   * Query still needs a round-trip to repopulate the `['datasets', 'list']`
   * cache after the invalidation that follows. The startup banner uses this
   * flag to stay visible through that gap so the Datasets page is not left
   * with only its small in-card spinner.
   */
  datasetsPrimed: boolean;
}

export const MlReadinessContext = createContext<MlReadiness>({
  coreReady: false,
  mlReady: false,
  mlLoading: true,
  mlError: null,
  workspaceReady: false,
  datasetsPrimed: false,
});

export function useMlReadiness() {
  return useContext(MlReadinessContext);
}
