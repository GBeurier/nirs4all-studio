/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { useNewExperimentLaunchSubmissionMutation } from "./useNewExperimentLaunchSubmissionMutation";
import { NATIVE_LOCAL_EXPERIMENT_EXECUTION_ADAPTER } from "@/lib/experimentExecutionAdapter";
import { buildExperimentLaunchPayloadPlan } from "@/lib/experimentLaunchPayload";

const notifications = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: notifications }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("keeps a refused native launch visible and never announces or navigates to a created run", async () => {
  const onRunCreated = vi.fn();
  const submitNativeLocalRun = vi.fn().mockRejectedValue({ status: 400, detail: "TabPFN is unavailable. Install tabpfn or remove this model." });
  const plan = buildExperimentLaunchPayloadPlan({
    executionAdapter: NATIVE_LOCAL_EXPERIMENT_EXECUTION_ADAPTER,
    legacyConfig: { name: "Test", dataset_ids: ["dataset-1"], pipeline_ids: ["pipeline-1"], execution_backend: "local-python", engine: "dag-ml", allow_fallback: false },
    strictCampaignSpecs: { splitSpecs: [], skippedRunIds: [] },
  });
  // The campaign plan has passed its own review; this test exercises the
  // selected Python environment's subsequent admission refusal.
  plan.strictCampaignPayloadActivation = { status: "ready", canUseStrictPayload: true, message: "Ready" };
  let state: ReturnType<typeof useNewExperimentLaunchSubmissionMutation>;
  function Consumer() {
    state = useNewExperimentLaunchSubmissionMutation({ executionAdapter: NATIVE_LOCAL_EXPERIMENT_EXECUTION_ADAPTER, launchSubmitters: { submitNativeLocalRun }, onRunCreated });
    return <span>{state.launchError}</span>;
  }
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><Consumer /></QueryClientProvider>));
    await act(async () => {
      state!.submitLaunchPayloadPlan(plan);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(submitNativeLocalRun).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("TabPFN is unavailable");
    expect(onRunCreated).not.toHaveBeenCalled();
    expect(notifications.success).not.toHaveBeenCalled();
    await act(async () => state!.clearLaunchError());
    expect(container.textContent).toBe("");
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});
