import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ScoreCardTree, type ScoreCardNode } from "./ScoreCardTree.js";

describe("ScoreCardTree", () => {
  it("renders a recursive metric tree with native details", () => {
    const nodes: ScoreCardNode[] = [
      {
        id: "refit",
        label: "Refit",
        kind: "refit",
        metrics: [{ label: "RMSE", value: "0.81", tone: "positive" }],
        children: [
          {
            id: "cv",
            label: "CrossVal",
            kind: "crossval",
            children: [
              { id: "fold-1", label: "Fold 1", metrics: [{ label: "R2", value: "0.95" }] },
            ],
          },
        ],
      },
    ];

    const markup = renderToStaticMarkup(
      <ScoreCardTree
        nodes={nodes}
        className="score-tree"
        nodeClassName="score-node"
        metricValueClassName="metric-value"
      />,
    );

    expect(markup).toContain("class=\"score-tree\"");
    expect(markup).toContain("<details");
    expect(markup).toContain("open=\"\"");
    expect(markup).toContain("data-kind=\"refit\"");
    expect(markup).toContain("data-kind=\"crossval\"");
    expect(markup).toContain("Fold 1");
    expect(markup).toContain("data-tone=\"positive\"");
    expect(markup).toContain("class=\"metric-value\"");
  });

  it("renders a caller-provided metric renderer and empty fallback", () => {
    const custom = renderToStaticMarkup(
      <ScoreCardTree
        nodes={[{ id: "n", label: "N", metrics: [{ label: "RMSE", value: "0.1" }] }]}
        renderMetric={(m) => <em>{`${m.label}=${m.value}`}</em>}
      />,
    );
    expect(custom).toContain("<em>RMSE=0.1</em>");

    expect(renderToStaticMarkup(<ScoreCardTree nodes={[]} empty={<span>No scores</span>} />))
      .toContain("No scores");
  });
});
