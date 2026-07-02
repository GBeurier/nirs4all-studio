/**
 * Pins the public surface of the `nirs4all-ui/runtime` foundation barrel.
 */
import { describe, expect, it } from "vitest";

import * as runtimeFoundation from "./index.js";

describe("nirs4all-ui/runtime barrel", () => {
  it("re-exports runtime/result status helpers", () => {
    expect(Array.isArray(runtimeFoundation.RUNTIME_RESULT_STATUSES)).toBe(true);
    expect(typeof runtimeFoundation.isRuntimeResultStatus).toBe("function");
    expect(typeof runtimeFoundation.resolveRuntimeResultStatus).toBe("function");
    expect(typeof runtimeFoundation.getRuntimeResultStatusDisplay).toBe("function");
    expect(typeof runtimeFoundation.isBusyRuntimeResultStatus).toBe("function");
    expect(typeof runtimeFoundation.getRuntimeResultStatusProgress).toBe("function");
    expect(typeof runtimeFoundation.buildRuntimeResultStatusView).toBe("function");
    expect(typeof runtimeFoundation.getRuntimeResultEmptyMessage).toBe("function");
    expect(typeof runtimeFoundation.buildRuntimeEngineStatus).toBe("function");
    expect(typeof runtimeFoundation.normalizeRuntimeDiagnostics).toBe("function");
    expect(typeof runtimeFoundation.buildRuntimeNativeResultsAffordance).toBe("function");
    expect(typeof runtimeFoundation.runtimeEngineLabel).toBe("function");
  });

  it("wires display tokens through the barrel", () => {
    expect(runtimeFoundation.getRuntimeResultStatusDisplay("completed")).toMatchObject({
      label: "Completed",
      badgeVariant: "default",
    });
    expect(runtimeFoundation.isBusyRuntimeResultStatus("running")).toBe(true);
  });

  it("formats dag-ml runtime lineage labels", () => {
    expect(runtimeFoundation.runtimeEngineLabel({ executed: true, compiled: true })).toBe("executed by dag-ml");
    expect(runtimeFoundation.runtimeEngineLabel({ compiled: true })).toBe("compiled by dag-ml");
    expect(runtimeFoundation.runtimeEngineLabel({})).toBeNull();
    expect(runtimeFoundation.runtimeEngineLabel(null)).toBeNull();
  });
});
