import { beforeEach, describe, expect, it, vi } from "vitest";

import { runPrediction, runPredictionWithFile } from "./predict";

const transport = vi.hoisted(() => ({
  post: vi.fn(),
  requestForm: vi.fn(),
}));

vi.mock("./transport", () => ({
  api: { post: transport.post },
  requestForm: transport.requestForm,
}));

beforeEach(() => {
  transport.post.mockReset().mockResolvedValue({});
  transport.requestForm.mockReset().mockResolvedValue({});
});

describe("prediction native runtime transport", () => {
  it("overrides retired engine and fallback fields fail-closed", async () => {
    await runPrediction({
      model_id: "model-1",
      model_source: "bundle",
      data_source: "dataset",
      dataset_id: "dataset-1",
      engine: "legacy",
      allow_fallback: true,
    });

    expect(transport.post).toHaveBeenCalledWith("/predict", expect.objectContaining({
      engine: "dag-ml",
      allow_fallback: false,
    }));
  });

  it("always submits strict native fields for file prediction", async () => {
    await runPredictionWithFile(
      "model-1",
      "bundle",
      new File(["x"], "spectra.csv", { type: "text/csv" }),
    );

    const form = transport.requestForm.mock.calls[0]?.[1] as FormData;
    expect(form.get("engine")).toBe("dag-ml");
    expect(form.get("allow_fallback")).toBe("false");
  });

  it("preserves an explicit no-header override rather than treating false as absent", async () => {
    await runPredictionWithFile("model-1", "chain", new File(["1,2"], "spectra.csv"), { has_header: false, output_index: 1 });
    const form = transport.requestForm.mock.calls[0]?.[1] as FormData;
    expect(form.get("has_header")).toBe("false");
    expect(form.get("output_index")).toBe("1");
  });
});
