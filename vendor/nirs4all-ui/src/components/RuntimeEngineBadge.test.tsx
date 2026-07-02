import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RuntimeEngineBadge } from "./RuntimeEngineBadge.js";

describe("RuntimeEngineBadge", () => {
  it("renders a shared dag-ml lineage badge", () => {
    expect(renderToStaticMarkup(<RuntimeEngineBadge lineage={{ executed: true }} />)).toContain(
      "executed by dag-ml",
    );
  });

  it("renders shared runtime status with fallback icon and title", () => {
    const markup = renderToStaticMarkup(
      <RuntimeEngineBadge
        source={{
          engine: "legacy",
          engine_requested: "dag-ml",
          diagnostics: [{ message: "scheduler degraded" }],
        }}
        defaultIcon={<span>cpu</span>}
        fallbackIcon={<span>alert</span>}
      />,
    );

    expect(markup).toContain("Legacy fallback");
    expect(markup).toContain("alert");
    expect(markup).toContain("title=\"Engine: Legacy\nRequested DAG-ML\n1 diagnostic\"");
  });

  it("renders nothing without a label or lineage", () => {
    expect(renderToStaticMarkup(<RuntimeEngineBadge />)).toBe("");
  });
});
