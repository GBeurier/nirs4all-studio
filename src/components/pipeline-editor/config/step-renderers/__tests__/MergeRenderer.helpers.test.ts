import { describe, expect, it } from "vitest";
import type { MergeConfig } from "../../../types";
import {
  clearStructuredSources,
  createDefaultPredictionSource,
  formatStructuredSourcesDraft,
  getFallbackMergeMode,
  getMergeSourceState,
  parseStructuredSourcesDraft,
  toggleFeatureSourcesInConfig,
  togglePredictionSourcesInConfig,
} from "../MergeRenderer.helpers";

describe("getMergeSourceState", () => {
  it("treats the default predictions mode as enabled without advanced config", () => {
    expect(getMergeSourceState({ mode: "predictions" })).toEqual({
      predictionsEnabled: true,
      featuresEnabled: false,
      advancedConfigCount: 0,
      hasAdvancedConfig: false,
    });
  });

  it("counts predictions, features and structured source payloads", () => {
    const config: MergeConfig = {
      mode: "custom",
      predictions: [
        createDefaultPredictionSource(),
        { branch: 1, select: "all" },
      ],
      features: [0, 2],
      sources: "concat",
    };

    expect(getMergeSourceState(config)).toEqual({
      predictionsEnabled: true,
      featuresEnabled: true,
      advancedConfigCount: 5,
      hasAdvancedConfig: true,
    });
  });
});

describe("getFallbackMergeMode", () => {
  it("falls back from structured sources based on configured source arrays", () => {
    expect(getFallbackMergeMode({ predictions: [createDefaultPredictionSource()] })).toBe(
      "predictions"
    );
    expect(getFallbackMergeMode({ features: [0] })).toBe("features");
    expect(
      getFallbackMergeMode({
        predictions: [createDefaultPredictionSource()],
        features: [0],
      })
    ).toBe("custom");
  });
});

describe("togglePredictionSourcesInConfig", () => {
  it("adds a default prediction source and switches to custom when features are enabled", () => {
    expect(togglePredictionSourcesInConfig({ mode: "features", features: [0] })).toEqual({
      mode: "custom",
      features: [0],
      predictions: [createDefaultPredictionSource()],
    });
  });

  it("clears prediction sources and keeps features mode when both sections are enabled", () => {
    expect(
      togglePredictionSourcesInConfig({
        mode: "custom",
        predictions: [{ branch: 1, select: { top_k: 2 }, metric: "r2" }],
        features: [0],
      })
    ).toEqual({
      mode: "features",
      predictions: [],
      features: [0],
    });
  });
});

describe("toggleFeatureSourcesInConfig", () => {
  it("adds branch zero and switches to custom when predictions are enabled", () => {
    expect(toggleFeatureSourcesInConfig({ mode: "predictions" })).toEqual({
      mode: "custom",
      features: [0],
    });
  });

  it("clears feature sources and returns to predictions mode", () => {
    expect(
      toggleFeatureSourcesInConfig({
        mode: "custom",
        predictions: [createDefaultPredictionSource()],
        features: [0, 2],
      })
    ).toEqual({
      mode: "predictions",
      predictions: [createDefaultPredictionSource()],
      features: [],
    });
  });
});

describe("structured source payload helpers", () => {
  it("formats undefined and serializable payloads for the textarea draft", () => {
    expect(formatStructuredSourcesDraft(undefined)).toBe("");
    expect(formatStructuredSourcesDraft("concat")).toBe("\"concat\"");
    expect(formatStructuredSourcesDraft({ left: [0], right: [1] })).toBe(
      '{\n  "left": [\n    0\n  ],\n  "right": [\n    1\n  ]\n}'
    );
  });

  it("parses empty, plain string, JSON string and object drafts", () => {
    expect(parseStructuredSourcesDraft("   ")).toEqual({ status: "empty" });
    expect(parseStructuredSourcesDraft("concat")).toEqual({
      status: "valid",
      value: "concat",
    });
    expect(parseStructuredSourcesDraft("\"stack\"")).toEqual({
      status: "valid",
      value: "stack",
    });
    expect(parseStructuredSourcesDraft('{"left":[0],"right":[1]}')).toEqual({
      status: "valid",
      value: { left: [0], right: [1] },
    });
  });

  it("marks invalid JSON-like drafts without changing the config", () => {
    expect(parseStructuredSourcesDraft("{bad json")).toEqual({
      status: "invalid",
    });
  });

  it("clears structured sources and restores the array-derived mode", () => {
    expect(
      clearStructuredSources({
        mode: "sources",
        predictions: [createDefaultPredictionSource()],
        features: [1],
        sources: { left: [0] },
      })
    ).toEqual({
      mode: "custom",
      predictions: [createDefaultPredictionSource()],
      features: [1],
      sources: undefined,
    });
  });
});
