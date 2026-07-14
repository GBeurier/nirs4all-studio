import { describe, expect, it, vi } from "vitest";

const transportMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  requestBinary: vi.fn(),
}));

vi.mock("./transport", () => ({
  api: {
    get: transportMocks.get,
    post: transportMocks.post,
  },
  requestBinary: transportMocks.requestBinary,
}));

import {
  computePredictionRobustnessReport,
  exportWorkspaceRobustnessReport,
  getPredictionRobustnessEvidence,
} from "./aggregatedPredictions";

describe("aggregatedPredictions API", () => {
  it("posts native robustness report requests for stored predictions", async () => {
    transportMocks.post.mockResolvedValue({
      robustness_id: "rob-1",
      prediction_id: "pred-1",
      summary_artifact: {},
      report_fingerprint: "robustness:abc",
    });

    await computePredictionRobustnessReport("pred-1", {
      robustness: {
        mode: "clean_frozen",
        scenarios: [{ kind: "observed", severity: 0 }],
      },
      name: "Studio observed robustness report",
    });

    expect(transportMocks.post).toHaveBeenCalledWith(
      "/aggregated-predictions/pred-1/robustness-report",
      {
        robustness: {
          mode: "clean_frozen",
          scenarios: [{ kind: "observed", severity: 0 }],
        },
        name: "Studio observed robustness report",
      },
    );
  });

  it("exports persisted native robustness reports without recomputation", async () => {
    const blob = new Blob(["# Robustness\n"], { type: "text/markdown" });
    transportMocks.requestBinary.mockResolvedValue(blob);

    const result = await exportWorkspaceRobustnessReport("rob report/1", "markdown");

    expect(result).toBe(blob);
    expect(transportMocks.requestBinary).toHaveBeenCalledWith(
      "/aggregated-predictions/robustness-reports/rob%20report%2F1/export?format=markdown",
      "GET",
    );
  });

  it("gets robustness evidence preflight for one stored prediction", async () => {
    transportMocks.get.mockResolvedValue({
      prediction_id: "pred-1",
      stored_prediction_scenarios: ["observed"],
      spectral_scenarios: ["spectral_noise"],
      can_compute_stored_prediction_report: true,
      can_compute_spectral_report: false,
      status: "ready_for_prediction_space_only",
      requirements: [],
      blockers: [],
    });

    await getPredictionRobustnessEvidence("pred-1");

    expect(transportMocks.get).toHaveBeenCalledWith(
      "/aggregated-predictions/pred-1/robustness-evidence",
    );
  });
});
