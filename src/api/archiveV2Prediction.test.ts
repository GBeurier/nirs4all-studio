import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ARCHIVE_V2_ARRAY_PREDICTION_ENDPOINT,
  predictPersistedArchiveV2Array,
} from "./archiveV2Prediction";
import type { ArchiveV2ArrayPredictionRequest } from "@/types/archiveV2Prediction";

const transport = vi.hoisted(() => ({
  postBoundedJson: vi.fn(),
}));

vi.mock("./transport", () => ({
  api: { postBoundedJson: transport.postBoundedJson },
}));

const request: ArchiveV2ArrayPredictionRequest = {
  schema_version: 1,
  operation: "archive_v2_predict",
  workspace_id: "workspace-a",
  archive: {
    ref: "models/perf001-multitarget.n4a",
    sha256: "a".repeat(64),
  },
  input: {
    kind: "array",
    sample_ids: ["predict.0", "predict.1"],
    x: [
      [1.5, 0.5],
      [3.5, 1.5],
    ],
    expected_target_names: ["protein", "moisture"],
  },
  execution: {
    engine: "core_rust_methods",
    allow_fallback: false,
  },
};

function response(): Record<string, unknown> {
  return {
    schema_version: 1,
    operation: "archive_v2_predict",
    archive_id: "archive:perf001",
    archive_sha256: request.archive.sha256,
    engine: "core_rust_methods",
    fallback_used: false,
    sample_ids: [...request.input.sample_ids],
    target_names: [...request.input.expected_target_names],
    values: [
      [1.6, 13.2],
      [2.5, 15],
    ],
    provenance: {
      executor: `nirs4all-core@0.3.23+libn4m-abi-2.2:${"b".repeat(64)}`,
      archive_ref: request.archive.ref,
      workspace_id: request.workspace_id,
    },
  };
}

beforeEach(() => {
  transport.postBoundedJson.mockReset();
});

describe("native Archive V2 array prediction client", () => {
  it("posts the frozen array-only request and returns the aligned response", async () => {
    transport.postBoundedJson.mockResolvedValue(response());

    await expect(predictPersistedArchiveV2Array(request)).resolves.toEqual(
      response(),
    );
    expect(transport.postBoundedJson).toHaveBeenCalledOnce();
    expect(transport.postBoundedJson).toHaveBeenCalledWith(
      ARCHIVE_V2_ARRAY_PREDICTION_ENDPOINT,
      request,
      2 * 1024 * 1024,
    );
  });

  it("refuses fallback or non-array request drift before transport", async () => {
    const fallback = {
      ...request,
      execution: { ...request.execution, allow_fallback: true },
    } as unknown as ArchiveV2ArrayPredictionRequest;
    await expect(predictPersistedArchiveV2Array(fallback)).rejects.toThrow(
      "Invalid native Archive V2 array prediction request",
    );

    const dataset = {
      ...request,
      input: { ...request.input, kind: "dataset", dataset_id: "dataset-a" },
    } as unknown as ArchiveV2ArrayPredictionRequest;
    await expect(predictPersistedArchiveV2Array(dataset)).rejects.toThrow(
      "Invalid native Archive V2 array prediction request",
    );
    expect(transport.postBoundedJson).not.toHaveBeenCalled();
  });

  it.each([
    ["fallback", { fallback_used: true }],
    ["sample order", { sample_ids: ["predict.1", "predict.0"] }],
    ["archive identity", { archive_sha256: "c".repeat(64) }],
    [
      "provenance",
      {
        provenance: {
          executor: "nirs4all-core",
          archive_ref: "models/other.n4a",
          workspace_id: request.workspace_id,
        },
      },
    ],
    [
      "executor identity",
      {
        provenance: {
          executor: `nirs4all-core@0.3.24+libn4m-abi-2.2:${"b".repeat(64)}`,
          archive_ref: request.archive.ref,
          workspace_id: request.workspace_id,
        },
      },
    ],
  ])("refuses %s response drift", async (_label, override) => {
    transport.postBoundedJson.mockResolvedValue({
      ...response(),
      ...override,
    });

    await expect(predictPersistedArchiveV2Array(request)).rejects.toThrow(
      "Invalid native Archive V2 array prediction response",
    );
  });

  it("refuses non-finite or incorrectly shaped response matrices", async () => {
    transport.postBoundedJson.mockResolvedValue({
      ...response(),
      values: [
        [Number.NaN, 13.2],
        [2.5, 15],
      ],
    });
    await expect(predictPersistedArchiveV2Array(request)).rejects.toThrow(
      "Invalid native Archive V2 array prediction response",
    );

    transport.postBoundedJson.mockResolvedValue({
      ...response(),
      values: [[1.6], [2.5]],
    });
    await expect(predictPersistedArchiveV2Array(request)).rejects.toThrow(
      "Invalid native Archive V2 array prediction response",
    );
  });
});
