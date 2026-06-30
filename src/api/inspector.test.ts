import { afterEach, describe, expect, it, vi } from "vitest";

import { getBranchTopologyData } from "./inspector";
import { resetBackendUrl } from "./transport";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  resetBackendUrl();
  vi.unstubAllGlobals();
});

describe("inspector API", () => {
  it("keeps branch topology legacy query params when score_ref is absent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ nodes: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await getBranchTopologyData({
      pipeline_id: "pipe-1",
      score_column: "cv_val_score",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/inspector/branch-topology?pipeline_id=pipe-1&score_column=cv_val_score",
      expect.any(Object),
    );
  });

  it("serializes branch topology score_ref as a JSON query parameter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ nodes: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await getBranchTopologyData({
      pipeline_id: "pipe-1",
      score_column: "cv_val_score",
      score_ref: {
        protocol: "cross_validation",
        partition: "test",
        aggregation: "fold_mean",
        legacyScoreColumn: "cv_test_score",
      },
    });

    const [url] = fetchMock.mock.calls[0];
    const params = new URLSearchParams(String(url).split("?")[1]);

    expect(params.get("pipeline_id")).toBe("pipe-1");
    expect(params.get("score_column")).toBe("cv_val_score");
    expect(JSON.parse(params.get("score_ref") ?? "{}")).toMatchObject({
      protocol: "cross_validation",
      partition: "test",
      aggregation: "fold_mean",
      legacyScoreColumn: "cv_test_score",
    });
  });
});
