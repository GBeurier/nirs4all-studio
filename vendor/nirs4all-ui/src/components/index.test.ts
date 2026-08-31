import { describe, expect, it } from "vitest";

import * as components from "./index.js";

describe("nirs4all-ui/components barrel", () => {
  it("re-exports the public React components", () => {
    expect(typeof components.DatasetPreviewCard).toBe("function");
    expect(typeof components.MetricValueBadge).toBe("function");
    expect(typeof components.RuntimeDiagnosticList).toBe("function");
    expect(typeof components.RuntimeEngineBadge).toBe("function");
    expect(typeof components.RuntimeResultStatusBadge).toBe("function");
  });
});
