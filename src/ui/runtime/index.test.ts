/**
 * Pins the public surface of the `@/ui/runtime` foundation barrel.
 */
import { describe, expect, it } from "vitest";

import * as runtimeFoundation from "./index";

describe("@/ui/runtime barrel", () => {
  it("re-exports runtime/result status helpers", () => {
    expect(Array.isArray(runtimeFoundation.RUNTIME_RESULT_STATUSES)).toBe(true);
    expect(typeof runtimeFoundation.isRuntimeResultStatus).toBe("function");
    expect(typeof runtimeFoundation.resolveRuntimeResultStatus).toBe("function");
    expect(typeof runtimeFoundation.getRuntimeResultStatusDisplay).toBe("function");
    expect(typeof runtimeFoundation.isBusyRuntimeResultStatus).toBe("function");
    expect(typeof runtimeFoundation.getRuntimeResultStatusProgress).toBe("function");
    expect(typeof runtimeFoundation.buildRuntimeResultStatusView).toBe("function");
    expect(typeof runtimeFoundation.getRuntimeResultEmptyMessage).toBe("function");
  });

  it("wires display tokens through the barrel", () => {
    expect(runtimeFoundation.getRuntimeResultStatusDisplay("completed")).toMatchObject({
      label: "Completed",
      badgeVariant: "default",
    });
    expect(runtimeFoundation.isBusyRuntimeResultStatus("running")).toBe(true);
  });
});
