/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  archiveV2SelectionIdentityEquals,
  buildArchiveV2ArrayPredictionRequest,
  createPersistedArchiveV2Selection,
  persistArchiveV2Selection,
  readPersistedArchiveV2Selection,
} from "./archiveV2Selection";
import { clientStorageKeys } from "./clientStorage/keyRegistry";

function selection() {
  return createPersistedArchiveV2Selection({
    workspace_id: "workspace-a",
    archive_ref: "models/calibration.n4a",
    archive_sha256: "a".repeat(64),
    n_features: 2,
    target_names: ["protein", "moisture"],
  });
}

beforeEach(() => {
  localStorage.clear();
});

describe("persisted Archive V2 selection", () => {
  it("round-trips the bounded immutable archive identity", () => {
    const value = selection();
    persistArchiveV2Selection(value);

    expect(readPersistedArchiveV2Selection()).toEqual(value);
    expect(JSON.parse(localStorage.getItem(clientStorageKeys.predictArchiveV2Selection.key)!))
      .toEqual({ version: 1, value });
  });

  it.each([
    ["legacy bundle", { id: "model-a", source: "bundle", bundle_path: "/tmp/a.joblib" }],
    ["legacy chain", { id: "chain-a", source: "chain" }],
    ["unknown version", { version: 2, value: selection() }],
  ])("clears %s selections without reinterpreting them", (_label, value) => {
    localStorage.setItem(
      clientStorageKeys.predictArchiveV2Selection.key,
      JSON.stringify(value),
    );

    expect(readPersistedArchiveV2Selection()).toBeNull();
    expect(localStorage.getItem(clientStorageKeys.predictArchiveV2Selection.key)).toBeNull();
  });

  it("builds the frozen native request with ordered targets", () => {
    expect(buildArchiveV2ArrayPredictionRequest(selection(), [[1, 2], [3, 4]])).toEqual({
      schema_version: 1,
      operation: "archive_v2_predict",
      workspace_id: "workspace-a",
      archive: {
        ref: "models/calibration.n4a",
        sha256: "a".repeat(64),
      },
      input: {
        kind: "array",
        sample_ids: ["predict.0", "predict.1"],
        x: [[1, 2], [3, 4]],
        expected_target_names: ["protein", "moisture"],
      },
      execution: { engine: "core_rust_methods", allow_fallback: false },
    });
  });

  it("refuses width, ordered-target, path, and identity drift", () => {
    expect(() => buildArchiveV2ArrayPredictionRequest(selection(), [[1, 2, 3]]))
      .toThrow("exactly 2 finite features");
    expect(() => createPersistedArchiveV2Selection({
      workspace_id: "workspace-a",
      archive_ref: "/absolute/model.n4a",
      archive_sha256: "a".repeat(64),
      n_features: 2,
      target_names: ["protein", "protein"],
    })).toThrow("Invalid Archive V2 selection");

    const moved = { ...selection(), archive_ref: "models/moved.n4a" };
    const reordered = { ...selection(), target_names: ["moisture", "protein"] };
    expect(archiveV2SelectionIdentityEquals(selection(), moved)).toBe(false);
    expect(archiveV2SelectionIdentityEquals(selection(), reordered)).toBe(false);
  });
});
