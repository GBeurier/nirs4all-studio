import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RuntimeDiagnosticList } from "./RuntimeDiagnosticList.js";

describe("RuntimeDiagnosticList", () => {
  it("normalizes and renders runtime diagnostics from a source payload", () => {
    const markup = renderToStaticMarkup(
      <RuntimeDiagnosticList
        source={{
          diagnostics: [
            {
              verb: "run",
              cause: "unsupported_capability",
              message: "dag-ml refused the schedule",
              mitigation: "Simplify the graph.",
              unsupported_capability: "branch_duplication",
            },
          ],
        }}
        className="diagnostics"
        itemClassName={(item) => `tone-${item.tone}`}
      />,
    );

    expect(markup).toContain("class=\"diagnostics\"");
    expect(markup).toContain("class=\"tone-warning\"");
    expect(markup).toContain("Run / Unsupported Capability");
    expect(markup).toContain("dag-ml refused the schedule");
    expect(markup).toContain("Mitigation: Simplify the graph.");
    expect(markup).toContain("Missing capability: Branch Duplication");
  });

  it("renders caller-owned empty content when no diagnostics exist", () => {
    expect(renderToStaticMarkup(
      <RuntimeDiagnosticList diagnostics={[]} empty={<span>No diagnostics</span>} />,
    )).toContain("No diagnostics");
  });
});
