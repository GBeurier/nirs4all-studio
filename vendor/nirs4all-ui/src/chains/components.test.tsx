import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { fromScoredChains, positionMatrix, sequenceMatrix } from "./analysis.js";
import { ChainExplorer } from "./ChainExplorer.js";
import { ChainNodeHub } from "./ChainNodeHub.js";
import { ChainNodeOrbit } from "./ChainNodeOrbit.js";
import { ChainScoreBeeswarm } from "./ChainScoreBeeswarm.js";
import { NodeEffectForest } from "./NodeEffectForest.js";
import { PositionEffectHeatmap } from "./PositionEffectHeatmap.js";
import { SequenceEffectHeatmap } from "./SequenceEffectHeatmap.js";
import type { ChainMetric, ScoredChain } from "./types.js";

const NRMSE: ChainMetric = { key: "nrmse", label: "nRMSE", lowerIsBetter: true };

function corpus(): ScoredChain[] {
  const chains: ScoredChain[] = [];
  const pres = ["snv", "msc", "detr"];
  const models = ["pls", "rf"];
  const datasets = ["wheat", "soil"];
  let i = 0;
  for (const dataset of datasets) {
    for (const a of pres) {
      for (const b of pres) {
        if (a === b) continue;
        for (const model of models) {
          i += 1;
          const base = a === "snv" ? 0.1 : a === "msc" ? 0.16 : 0.2;
          const order = a === "snv" && b === "msc" ? -0.02 : 0.02;
          const modelPen = model === "pls" ? 0 : 0.05;
          const scale = dataset === "soil" ? 18 : 1;
          chains.push({
            id: `c${i}`,
            dataset,
            source: i % 2 === 0 ? "nir" : "mir",
            score: (base + order + modelPen + (i % 3) * 0.005) * scale,
            steps: [
              { token: "split_kfold", label: "KFold", role: "split" },
              { token: a, label: a.toUpperCase(), role: "preprocess" },
              { token: b, label: b.toUpperCase(), role: "preprocess" },
              { token: model, label: model.toUpperCase(), role: "model" },
            ],
          });
        }
      }
    }
  }
  return chains;
}

const analysis = fromScoredChains(corpus(), { metric: NRMSE, lens: "rankByDataset" });

describe("NodeEffectForest", () => {
  it("renders a clickable row per token with the baseline", () => {
    const markup = renderToStaticMarkup(<NodeEffectForest analysis={analysis} onSelectToken={() => {}} />);
    expect(markup).toContain("n4chains-forest");
    expect(markup).toContain("baseline");
    expect(markup).toContain("SNV");
    expect(markup).toContain("is-interactive");
  });
});

describe("PositionEffectHeatmap", () => {
  it("renders bucket columns and token rows", () => {
    const markup = renderToStaticMarkup(<PositionEffectHeatmap matrix={positionMatrix(analysis, { mode: "absolute", minCount: 1 })} />);
    expect(markup).toContain("n4chains-position");
    expect(markup).toContain("1st");
    expect(markup).toContain("better");
  });
});

describe("SequenceEffectHeatmap", () => {
  it("renders predecessor/successor axes", () => {
    const markup = renderToStaticMarkup(<SequenceEffectHeatmap matrix={sequenceMatrix(analysis, { minCount: 1 })} />);
    expect(markup).toContain("n4chains-sequence");
    expect(markup).toContain("successor");
    expect(markup).toContain("predecessor");
  });
});

describe("ChainScoreBeeswarm", () => {
  it("renders with and without lanes for a focus token", () => {
    const markup = renderToStaticMarkup(<ChainScoreBeeswarm analysis={analysis} focusToken="snv" />);
    expect(markup).toContain("n4chains-beeswarm");
    expect(markup).toContain("With SNV");
    expect(markup).toContain("Without");
  });
});

describe("ChainNodeOrbit", () => {
  it("renders the focus center, sunburst wedges, breadcrumb and flow legend", () => {
    const markup = renderToStaticMarkup(<ChainNodeOrbit analysis={analysis} defaultFocusToken="snv" depth={2} />);
    expect(markup).toContain("n4chains-orbit");
    expect(markup).toContain("n4chains-wedge");
    expect(markup).toContain("n4chains-orbit-center");
    expect(markup).toContain("before");
    expect(markup).toContain("after");
  });

  it("renders an empty state for an unknown focus", () => {
    const markup = renderToStaticMarkup(<ChainNodeOrbit analysis={analysis} defaultFocusToken="nope" />);
    expect(markup).toContain("No node to explore");
  });
});

describe("ChainNodeHub", () => {
  it("renders the predecessor pie core, the focus band, and outer successor rings", () => {
    const markup = renderToStaticMarkup(<ChainNodeHub analysis={analysis} defaultFocusToken="snv" depth={2} />);
    expect(markup).toContain("n4chains-hub");
    expect(markup).toContain("n4chains-hub-focus");
    expect(markup).toContain("centre = predecessors");
  });
});

describe("ChainExplorer", () => {
  it("renders the toolbar, filters, and composed panels from raw chains", () => {
    const markup = renderToStaticMarkup(<ChainExplorer chains={corpus()} metric={NRMSE} />);
    expect(markup).toContain("n4chains-explorer");
    expect(markup).toContain("Chain effect explorer");
    expect(markup).toContain("Rank in dataset");
    expect(markup).toContain("Node influence ranking");
    expect(markup).toContain("Effect by position");
    expect(markup).toContain("Effect by order");
    expect(markup).toContain("chains");
  });

  it("renders an empty state with no chains", () => {
    const markup = renderToStaticMarkup(<ChainExplorer chains={[]} metric={NRMSE} />);
    expect(markup).toContain("No chains to analyze");
  });
});
