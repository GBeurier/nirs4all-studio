import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RankingsTable } from "./RankingsTable.js";

describe("RankingsTable", () => {
  it("renders a leaderboard with a highlighted row and detail column", () => {
    const markup = renderToStaticMarkup(
      <RankingsTable
        rows={[
          { rank: 1, name: "PLS", score: "0.812", detail: "8 comps", highlight: true },
          { rank: 2, name: "Ridge", score: "0.790" },
        ]}
        metricLabel="RMSE"
        className="rankings"
        rowClassName="row"
        highlightRowClassName="row-best"
        nameClassName="name-cell"
      />,
    );

    expect(markup).toContain("class=\"rankings\"");
    expect(markup).toContain("RMSE");
    expect(markup).toContain("data-highlight=\"true\"");
    expect(markup).toContain("row row-best");
    expect(markup).toContain("PLS");
    expect(markup).toContain("8 comps");
    expect(markup).toContain("0.790");
  });

  it("omits the detail column when no row has a detail and honors empty fallback", () => {
    const markup = renderToStaticMarkup(
      <RankingsTable rows={[{ rank: 1, name: "PLS", score: "0.8" }]} headers={{ name: "Model" }} />,
    );
    expect(markup).toContain("Model");
    expect(markup).not.toContain("Detail");

    expect(renderToStaticMarkup(<RankingsTable rows={[]} empty={<span>No models</span>} />))
      .toContain("No models");
  });
});
