import { describe, expect, it } from "vitest";

import {
  buildRuntimeEngineStatus,
  buildRuntimeNativeResultsAffordance,
  formatRuntimeEngineTitle,
  formatRuntimeTokenLabel,
  normalizeRuntimeDiagnostics,
} from "./resultMetadata.js";

describe("runtime result metadata foundation", () => {
  it("formats runtime tokens for compact UI labels", () => {
    expect(formatRuntimeTokenLabel("dag-ml")).toBe("DAG-ML");
    expect(formatRuntimeTokenLabel("legacy")).toBe("Legacy");
    expect(formatRuntimeTokenLabel("local-python")).toBe("Local Python");
  });

  it("builds engine status and diagnostics from direct pipeline fields", () => {
    const diagnostic = {
      verb: "run",
      cause: "unsupported_shape",
      message: "dag-ml does not support this pipeline shape",
      mitigation: "Run on engine='legacy'.",
    };

    expect(buildRuntimeEngineStatus({
      engine: "legacy",
      engine_requested: "dag-ml",
      engine_diagnostics: [diagnostic],
    })).toEqual({
      engine: "legacy",
      engineLabel: "Legacy",
      requestedEngine: "dag-ml",
      requestedEngineLabel: "DAG-ML",
      badgeLabel: "Legacy fallback",
      detailLabel: "Requested DAG-ML",
      isFallback: true,
      tone: "warning",
      diagnostics: [{
        id: "0-unsupported_shape-dag-ml does not support this pip",
        verb: "run",
        cause: "unsupported_shape",
        message: "dag-ml does not support this pipeline shape",
        mitigation: "Run on engine='legacy'.",
        unsupportedCapability: null,
        tone: "warning",
      }],
    });
  });

  it("accepts nested runtime result envelopes", () => {
    const status = buildRuntimeEngineStatus({
      rt_result: {
        manifest: { engine: "dag-ml" },
        diagnostics: [{ message: "native result attached", level: "info" }],
      },
    });

    expect(status).toMatchObject({
      engine: "dag-ml",
      engineLabel: "DAG-ML",
      badgeLabel: "DAG-ML",
      isFallback: false,
      tone: "success",
    });
    expect(status?.diagnostics).toHaveLength(1);
    expect(normalizeRuntimeDiagnostics({
      runtime_result: {
        diagnostics: ["plain diagnostic"],
      },
    })[0]).toMatchObject({
      message: "plain diagnostic",
      tone: "info",
    });
  });

  it("infers requested runtime from persisted run config fallback policy", () => {
    expect(buildRuntimeEngineStatus({
      config: {
        requested_engine: "dag-ml",
        fallback_policy: {
          source: "nirs4all.run.allow_fallback",
          engine_requested: "dag-ml",
          allow_fallback: false,
          mode: "refuse_fallback",
        },
      },
    })).toMatchObject({
      engine: null,
      engineLabel: null,
      requestedEngine: "dag-ml",
      requestedEngineLabel: "DAG-ML",
      badgeLabel: "Requested DAG-ML",
      isFallback: false,
      tone: "default",
    });
  });

  it("treats config.engine as a request selector, not the actual engine", () => {
    expect(buildRuntimeEngineStatus({
      config: {
        engine: "dag-ml",
      },
    })).toMatchObject({
      engine: null,
      requestedEngine: "dag-ml",
      badgeLabel: "Requested DAG-ML",
    });
  });

  it("builds native-results export affordance copy", () => {
    expect(buildRuntimeNativeResultsAffordance({
      hasRefit: true,
      nativeArtifactCount: 2,
    })).toEqual({
      hasNativeResults: true,
      artifactCount: 2,
      nativeResultsLabel: "2 native artifacts",
      exportLabel: "Export Final Model (.n4a)",
      exportDescription: "Exports the refit model trained on the full dataset",
      disabled: false,
      disabledReason: null,
    });

    expect(buildRuntimeNativeResultsAffordance({
      disabledReason: "Native artifacts are missing",
    })).toMatchObject({
      hasNativeResults: false,
      nativeResultsLabel: "Native results not attached",
      disabled: true,
      disabledReason: "Native artifacts are missing",
    });

    expect(buildRuntimeNativeResultsAffordance({
      hasNativeResults: false,
      nativeArtifactCount: 0,
    })).toMatchObject({
      hasNativeResults: false,
      nativeResultsLabel: "Native results not attached",
      disabled: true,
      disabledReason: "Native result artifacts are not attached for this run.",
    });
  });

  it("formats runtime engine title text from shared status metadata", () => {
    const status = buildRuntimeEngineStatus({
      engine: "legacy",
      engine_requested: "dag-ml",
      diagnostics: [{ message: "scheduler degraded" }],
    });

    expect(formatRuntimeEngineTitle(status)).toBe("Engine: Legacy\nRequested DAG-ML\n1 diagnostic");
    expect(formatRuntimeEngineTitle(null)).toBeNull();
  });
});
