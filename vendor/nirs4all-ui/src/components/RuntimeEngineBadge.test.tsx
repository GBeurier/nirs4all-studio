import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RuntimeEngineBadge } from "./RuntimeEngineBadge.js";

describe("RuntimeEngineBadge", () => {
  it("renders a shared dag-ml lineage badge", () => {
    expect(renderToStaticMarkup(<RuntimeEngineBadge lineage={{ executed: true }} />)).toContain(
      "executed by dag-ml",
    );
  });

  it("renders nothing without a label or lineage", () => {
    expect(renderToStaticMarkup(<RuntimeEngineBadge />)).toBe("");
  });
});
