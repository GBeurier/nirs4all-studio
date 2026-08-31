import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PerClassTable } from "./PerClassTable.js";

describe("PerClassTable", () => {
  it("renders per-class metrics with headers and default formatting", () => {
    const markup = renderToStaticMarkup(
      <PerClassTable
        rows={[
          { label: "healthy", precision: 0.9123, recall: 0.8, f1: 0.8534, support: 42 },
          { label: "diseased", precision: 0.7, recall: 0.6543, f1: 0.6765, support: 18 },
        ]}
        headers={{ class: "Class", precision: "Prec." }}
        className="per-class"
        labelCellClassName="class-cell"
        cellClassName="metric-cell"
      />,
    );

    expect(markup).toContain("class=\"per-class\"");
    expect(markup).toContain("<thead");
    expect(markup).toContain("Prec.");
    expect(markup).toContain("data-class=\"healthy\"");
    expect(markup).toContain("0.912");
    expect(markup).toContain(">42<");
    expect(markup).toContain("class=\"class-cell\"");
  });

  it("omits the header when headers are absent and honors empty fallback", () => {
    const markup = renderToStaticMarkup(
      <PerClassTable rows={[{ label: "a", precision: 1, recall: 1, f1: 1, support: 3 }]} />,
    );
    expect(markup).not.toContain("<thead");
    expect(markup).toContain("1.000");

    expect(renderToStaticMarkup(<PerClassTable rows={[]} empty={<span>No classes</span>} />))
      .toContain("No classes");
  });
});
