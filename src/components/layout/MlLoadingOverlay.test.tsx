/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { MlReadinessContext, type MlReadiness } from "@/context/useMlReadiness";
import { MlLoadingOverlay } from "./MlLoadingOverlay";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("capability-specific page readiness", () => {
  it("does not unlock native prediction merely because Python is ready", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const readiness: MlReadiness = {
      controlReady: true, controlStatus: "running", controlError: null,
      scientificStatus: "running", scientificRequested: true,
      coreReady: true, mlReady: true, mlLoading: false, mlError: null,
      nativePredictionReady: false, workspaceReady: true, datasetsPrimed: true,
    };
    try {
      await act(async () => root.render(
        <MlReadinessContext.Provider value={readiness}>
          <MlLoadingOverlay capability="native-prediction"><button>Predict</button></MlLoadingOverlay>
        </MlReadinessContext.Provider>,
      ));
      expect(container.querySelector("[inert]")).not.toBeNull();
      expect(container.querySelector('[role="status"]')?.textContent)
        .toContain("Native prediction is unavailable");
    } finally {
      await act(async () => root.unmount());
    }
  });
});
