import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ARCHIVE_V2_ARRAY_PREDICTION_ENDPOINT,
  ARCHIVE_V2_CONFORMAL_PRESENTATION_ENDPOINT,
  ARCHIVE_V2_CONFORMAL_PROJECTION_ENDPOINT,
  getPersistedArchiveV2ConformalPresentation,
  getPersistedArchiveV2Catalogue,
  predictPersistedArchiveV2Array,
  projectPersistedArchiveV2ConformalPresentation,
} from "./archiveV2Prediction";
import type {
  ArchiveV2ArrayPredictionRequest,
  ArchiveV2ConformalPresentationRequest,
} from "@/types/archiveV2Prediction";

const transport = vi.hoisted(() => ({
  postBoundedJson: vi.fn(),
  getBoundedJson: vi.fn(),
}));

vi.mock("./transport", () => ({
  api: { postBoundedJson: transport.postBoundedJson, getBoundedJson: transport.getBoundedJson },
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

const conformalRequest: ArchiveV2ConformalPresentationRequest = {
  schema_version: 2,
  operation: "archive_v2_conformal_presentation",
  workspace_id: "workspace-a",
  archive: { ref: "artifacts/models/model.n4a", sha256: "a".repeat(64) },
  presentation_fingerprint: "f".repeat(64),
};

function conformalPresentation(): Record<string, unknown> {
  const sampleIds = ["sample:two", "sample:one"];
  const targetNames = ["protein", "moisture"];
  return {
    schema_version: 2,
    archive_sha256: conformalRequest.archive.sha256,
    package_fingerprint: "b".repeat(64),
    replay_outcome_fingerprint: "c".repeat(64),
    binding_id: "output:main",
    predictor: {
      model_artifact_fingerprint: "d".repeat(64),
      predictor_binding_fingerprint: "e".repeat(64),
      predictor_descriptor_fingerprint: "1".repeat(64),
    },
    dimensions: { sample_count: 2, target_count: 2 },
    target_names: targetNames,
    sample_ids: sampleIds,
    point_prediction: {
      prediction_id: "prediction:production",
      producer_node: "model:regressor",
      producer_port: "prediction",
      partition: "final",
      fold_id: null,
      sample_ids: sampleIds,
      values: [[10, 100], [20, 200]],
      target_names: targetNames,
    },
    interval_block: {
      schema_version: 2,
      binding_id: "output:main",
      sample_ids: sampleIds,
      intervals: [{
        coverage: 0.8,
        cells: [
          [{ status: "finite", lower: 9, upper: 11 }, { status: "finite", lower: 98, upper: 102 }],
          [{ status: "finite", lower: 19, upper: 21 }, { status: "finite", lower: 198, upper: 202 }],
        ],
      }],
      calibration_fingerprint: "2".repeat(64),
      point_prediction_fingerprint: "3".repeat(64),
    },
    guarantee: {
      calibration_sample_count: 4,
      multi_target_policy: "marginal",
      small_sample_policy: "error",
      quantiles: [{ coverage: 0.8, rank: 4, radii: [
        { status: "finite", value: 1 }, { status: "finite", value: 2 },
      ] }],
    },
    calibration_fingerprint: "2".repeat(64),
    presentation_fingerprint: conformalRequest.presentation_fingerprint,
  };
}

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
      executor: `nirs4all-core@0.3.29+libn4m-abi-2.5:${"b".repeat(64)}`,
      archive_ref: request.archive.ref,
      workspace_id: request.workspace_id,
    },
  };
}

beforeEach(() => {
  transport.postBoundedJson.mockReset();
  transport.getBoundedJson.mockReset();
});

describe("native Archive V2 array prediction client", () => {
  it("transports the ordered native multi-target conformal projection", async () => {
    transport.postBoundedJson.mockResolvedValue(conformalPresentation());

    const result = await getPersistedArchiveV2ConformalPresentation(conformalRequest);
    expect(result.sample_ids).toEqual(["sample:two", "sample:one"]);
    expect(result.target_names).toEqual(["protein", "moisture"]);
    expect(result.guarantee.quantiles[0].radii).toHaveLength(2);
    expect(transport.postBoundedJson).toHaveBeenCalledWith(
      ARCHIVE_V2_CONFORMAL_PRESENTATION_ENDPOINT,
      conformalRequest,
      2 * 1024 * 1024,
    );
  });

  it("persists a conformal projection and accepts only its aligned fingerprint reference", async () => {
    const registered = {
      ...request,
      archive: { ...request.archive, ref: "artifacts/models/model.n4a" },
    };
    const reference = {
      schema_version: 1,
      operation: "archive_v2_conformal_projection",
      archive_sha256: registered.archive.sha256,
      sample_ids: registered.input.sample_ids,
      target_names: registered.input.expected_target_names,
      presentation_fingerprint: "f".repeat(64),
    };
    transport.postBoundedJson.mockResolvedValue(reference);
    await expect(projectPersistedArchiveV2ConformalPresentation(registered)).resolves.toEqual(reference);
    expect(transport.postBoundedJson).toHaveBeenCalledWith(
      ARCHIVE_V2_CONFORMAL_PROJECTION_ENDPOINT,
      registered,
      2 * 1024 * 1024,
    );

    transport.postBoundedJson.mockResolvedValue({ ...reference, sample_ids: ["predict.1", "predict.0"] });
    await expect(projectPersistedArchiveV2ConformalPresentation(registered)).rejects.toThrow(
      "Invalid native conformal projection reference",
    );
  });

  it("refuses conformal cross-link, order, and dimension drift", async () => {
    const base = conformalPresentation();
    transport.postBoundedJson.mockResolvedValue({
      ...base,
      sample_ids: ["sample:one", "sample:two"],
    });
    await expect(getPersistedArchiveV2ConformalPresentation(conformalRequest)).rejects.toThrow(
      "Invalid native conformal presentation response",
    );

    transport.postBoundedJson.mockResolvedValue({ ...base, archive_sha256: "0".repeat(64) });
    await expect(getPersistedArchiveV2ConformalPresentation(conformalRequest)).rejects.toThrow(
      "Invalid native conformal presentation response",
    );

    transport.postBoundedJson.mockResolvedValue({
      ...base,
      dimensions: { sample_count: 2, target_count: 1 },
    });
    await expect(getPersistedArchiveV2ConformalPresentation(conformalRequest)).rejects.toThrow(
      "Invalid native conformal presentation response",
    );
  });

  it.each([1, 3])("refuses a conformal cell row with %i targets instead of two", async (targetCount) => {
    const base = conformalPresentation();
    transport.postBoundedJson.mockResolvedValue({
      ...base,
      interval_block: {
        ...(base.interval_block as Record<string, unknown>),
        intervals: [{ coverage: 0.8, cells: Array.from({ length: 2 }, () =>
          Array.from({ length: targetCount }, () => ({ status: "finite", lower: 9, upper: 11 }))),
        }],
      },
    });
    await expect(getPersistedArchiveV2ConformalPresentation(conformalRequest)).rejects.toThrow(
      "Invalid native conformal presentation response",
    );
  });

  it("loads a bounded Core-verified catalogue", async () => {
    const catalogue = { schema_version: 1, operation: "archive_v2_catalogue", workspace_id: "workspace-a", archives: [{ archive_id: "archive-a", archive_ref: "artifacts/model.n4a", archive_sha256: "a".repeat(64), n_features: 2, target_names: ["protein"], descriptor_fingerprint: "b".repeat(64), identity_status: "verified" }] };
    transport.getBoundedJson.mockResolvedValue(catalogue);
    await expect(getPersistedArchiveV2Catalogue("workspace-a")).resolves.toEqual(catalogue);
    expect(transport.getBoundedJson).toHaveBeenCalledWith("/workspaces/workspace-a/archive-v2", 256 * 1024);
  });
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

  it("catalogues and predicts the full native training spectral width", async () => {
    const catalogue = {
      schema_version: 1, operation: "archive_v2_catalogue", workspace_id: "workspace-a",
      archives: [{ archive_id: "archive-a", archive_ref: "artifacts/model.n4a",
        archive_sha256: "a".repeat(64), n_features: 8_192, target_names: ["protein"],
        descriptor_fingerprint: "b".repeat(64), identity_status: "verified" }],
    };
    transport.getBoundedJson.mockResolvedValue(catalogue);
    await expect(getPersistedArchiveV2Catalogue("workspace-a")).resolves.toEqual(catalogue);

    const wide = { ...request, input: { ...request.input,
      x: request.input.sample_ids.map(() => Array.from({ length: 8_192 }, () => 0.125)),
    } };
    transport.postBoundedJson.mockResolvedValue(response());
    await expect(predictPersistedArchiveV2Array(wide)).resolves.toEqual(response());
    expect(transport.postBoundedJson).toHaveBeenCalledWith(
      ARCHIVE_V2_ARRAY_PREDICTION_ENDPOINT, wide, 2 * 1024 * 1024,
    );
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
          executor: `nirs4all-core@0.3.28+libn4m-abi-2.5:${"b".repeat(64)}`,
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
