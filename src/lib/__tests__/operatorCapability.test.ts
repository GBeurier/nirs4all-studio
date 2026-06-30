import { describe, expect, it } from "vitest";

import {
  buildLegacyUnavailableFromCapabilityReport,
  compareCapabilityLevels,
  isExecutableCapabilityLevel,
  resolveOperatorCapability,
} from "../operatorCapability";

describe("operatorCapability", () => {
  it("orders planning and execution levels", () => {
    expect(compareCapabilityLevels("metadata", "plan")).toBeLessThan(0);
    expect(compareCapabilityLevels("execute_remote", "execute_local")).toBeGreaterThan(0);
    expect(isExecutableCapabilityLevel("plan")).toBe(false);
    expect(isExecutableCapabilityLevel("execute_wasm")).toBe(true);
  });

  it("keeps legacy unavailable entries as known metadata-only operators", () => {
    const resolution = resolveOperatorCapability(
      {
        classPath: "nirs4all.methods.OptionalOperator",
        id: "model.optional",
        name: "Optional",
        type: "model",
      },
      {
        unavailable: [{
          class_path: "nirs4all.methods.OptionalOperator",
          error: "nirs4all-methods is not installed",
          id: "model.optional",
          name: "Optional",
          type: "model",
        }],
      },
    );

    expect(resolution).toMatchObject({
      available: false,
      executable: false,
      level: "metadata",
      reason: "nirs4all-methods is not installed",
      source: "legacy_unavailable",
    });
  });

  it("prefers backend capability report entries over node defaults", () => {
    const resolution = resolveOperatorCapability(
      {
        capabilities: { defaultLevel: "execute_local" },
        id: "model.remote_only",
      },
      {
        capabilities: [{
          available: true,
          backend: "cluster",
          id: "model.remote_only",
          implementation_ref: "n4a-methods.remote",
          level: "execute_remote",
        }],
      },
    );

    expect(resolution).toMatchObject({
      available: true,
      backend: "cluster",
      executable: true,
      implementationRef: "n4a-methods.remote",
      level: "execute_remote",
      source: "backend_report",
    });
  });

  it("derives executable level from the strongest node implementation ref", () => {
    const resolution = resolveOperatorCapability({
      id: "model.multi_backend",
      implementationRefs: [
        { backend: "sklearn", id: "sklearn.local", level: "execute_local" },
        { backend: "wasm", id: "n4a.wasm", level: "execute_wasm" },
      ],
    });

    expect(resolution).toMatchObject({
      available: true,
      backend: "wasm",
      executable: true,
      implementationRef: "n4a.wasm",
      level: "execute_wasm",
      source: "node_declaration",
    });
  });

  it("derives legacy unavailable entries from non-executable capability entries", () => {
    expect(buildLegacyUnavailableFromCapabilityReport({
      capabilities: [{
        available: false,
        class_path: "pkg.MetadataOnly",
        id: "preprocessing.metadata",
        level: "metadata",
        name: "Metadata only",
        reason: "Available for preview but not execution",
        type: "preprocessing",
      }],
    })).toEqual([{
      class_path: "pkg.MetadataOnly",
      error: "Available for preview but not execution",
      function_path: undefined,
      id: "preprocessing.metadata",
      name: "Metadata only",
      type: "preprocessing",
    }]);
  });
});
