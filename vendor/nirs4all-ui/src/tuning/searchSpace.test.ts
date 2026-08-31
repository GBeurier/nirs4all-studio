import { describe, expect, it } from "vitest";

import orderedSearchSpaceFixture from "./__fixtures__/ordered_search_space_v1.json" with { type: "json" };
import {
  TUNING_ORDERED_SEARCH_SPACE_FORMAT,
  TUNING_ORDERED_SEARCH_SPACE_SCHEMA_ID,
  createTuningSearchSpacePreview,
  isJsonNativeValue,
  isOrderedTuningSearchSpaceArtifact,
  parseOrderedTuningSearchSpaceArtifact,
} from "./searchSpace.js";

const fingerprint = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const tuningFingerprint = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

const orderedSearchSpace = {
  fingerprint,
  force_params: [
    {
      path: "ridge.alpha",
      segments: ["ridge", "alpha"],
      value: 0.1,
    },
    {
      path: "scale.with_mean",
      segments: ["scale", "with_mean"],
      value: null,
    },
  ],
  format: "nirs4all.tuning.ordered_search_space",
  parameters: [
    {
      index: 0,
      path: "ridge.alpha",
      segments: ["ridge", "alpha"],
      spec: [0.1, 0.2],
    },
    {
      index: 1,
      path: "scale.with_mean",
      segments: ["scale", "with_mean"],
      spec: [false],
    },
  ],
  schema_version: 1,
  tuning_fingerprint: tuningFingerprint,
};

describe("ordered tuning search-space helpers", () => {
  it("validates nirs4all.tuning.ordered_search_space artifacts", () => {
    expect(TUNING_ORDERED_SEARCH_SPACE_FORMAT).toBe("nirs4all.tuning.ordered_search_space");
    expect(TUNING_ORDERED_SEARCH_SPACE_SCHEMA_ID).toBe(
      "https://nirs4all.org/schemas/tuning-ordered-search-space/v1",
    );
    expect(isOrderedTuningSearchSpaceArtifact(orderedSearchSpace)).toBe(true);
    expect(parseOrderedTuningSearchSpaceArtifact(orderedSearchSpace).fingerprint).toBe(fingerprint);
  });

  it("rejects ambiguous artifacts that Studio must not preview as executable", () => {
    expect(isOrderedTuningSearchSpaceArtifact({
      ...orderedSearchSpace,
      parameters: [
        { index: 1, path: "ridge.alpha", segments: ["ridge", "alpha"], spec: [0.1] },
      ],
    })).toBe(false);
    expect(isOrderedTuningSearchSpaceArtifact({
      ...orderedSearchSpace,
      parameters: [
        ...orderedSearchSpace.parameters,
        { index: 2, path: "ridge.alpha", segments: ["ridge", "alpha"], spec: [0.3] },
      ],
    })).toBe(false);
    expect(isOrderedTuningSearchSpaceArtifact({
      ...orderedSearchSpace,
      force_params: [{ path: "unknown.alpha", segments: ["unknown", "alpha"], value: 1 }],
    })).toBe(false);
    expect(() => parseOrderedTuningSearchSpaceArtifact({ ...orderedSearchSpace, fingerprint: "not-a-fingerprint" }))
      .toThrow("Expected a nirs4all.tuning.ordered_search_space payload.");
  });

  it("keeps validation JSON-native and rejects opaque runtime values", () => {
    expect(isJsonNativeValue({ options: [{ kind: "passthrough" }], enabled: true })).toBe(true);
    expect(isJsonNativeValue(Number.NaN)).toBe(false);
    expect(isJsonNativeValue(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isJsonNativeValue(undefined)).toBe(false);
    expect(isJsonNativeValue({ callback: () => 1 })).toBe(false);
    expect(isJsonNativeValue(new Date("2026-07-14T00:00:00Z"))).toBe(false);
  });

  it("projects a stable form preview without running an optimizer", () => {
    const preview = createTuningSearchSpacePreview(parseOrderedTuningSearchSpaceArtifact(orderedSearchSpace));

    expect(preview).toMatchObject({
      fingerprint,
      forceParamCount: 2,
      format: "nirs4all.tuning.ordered_search_space",
      parameterCount: 2,
      schemaId: "https://nirs4all.org/schemas/tuning-ordered-search-space/v1",
      schemaVersion: 1,
      tuningFingerprint,
    });
    expect(preview.parameters).toEqual([
      {
        forced: true,
        forcedValue: 0.1,
        forcedValueLabel: "0.1",
        index: 0,
        path: "ridge.alpha",
        segments: ["ridge", "alpha"],
        spec: [0.1, 0.2],
        specLabel: "[0.1,0.2]",
      },
      {
        forced: true,
        forcedValue: null,
        forcedValueLabel: "null",
        index: 1,
        path: "scale.with_mean",
        segments: ["scale", "with_mean"],
        spec: [false],
        specLabel: "[false]",
      },
    ]);
  });

  it("consumes the Python-generated cross-repo ordered search-space fixture", () => {
    const preview = createTuningSearchSpacePreview(
      parseOrderedTuningSearchSpaceArtifact(orderedSearchSpaceFixture),
    );

    expect(preview).toMatchObject({
      fingerprint: "ad5d4673e67321692f1635e3d8ed74efd3dbd26ad6ec236429d08c18f3466f5d",
      forceParamCount: 2,
      parameterCount: 3,
      schemaId: "https://nirs4all.org/schemas/tuning-ordered-search-space/v1",
      tuningFingerprint: "97695b1bd406085eb72fbd254a7e1f348616729acfedf802099b0abb028da9ec",
    });
    expect(preview.parameters.map((parameter) => parameter.path)).toEqual([
      "model.alpha",
      "model.n_components",
      "train.batch_size",
    ]);
    expect(preview.parameters[1]).toMatchObject({
      forced: true,
      forcedValue: 6,
      spec: {
        high: 12,
        low: 2,
        step: 1,
        type: "int",
      },
    });
    expect(preview.parameters[2]).toMatchObject({
      forced: true,
      forcedValue: 32,
      spec: [16, 32, 64],
    });
  });
});
