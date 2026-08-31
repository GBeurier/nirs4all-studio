import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DatasetPreviewCard } from "./DatasetPreviewCard.js";

describe("DatasetPreviewCard", () => {
  it("renders a host-styled dataset preview from a shared input contract", () => {
    const markup = renderToStaticMarkup(
      <DatasetPreviewCard
        dataset={{
          id: "soy-v1",
          name: "Soy protein NIR",
          description: "Reference spectra for protein regression.",
          taskType: "regression",
          sampleCount: 96,
          wavelengthCount: 128,
          targetCount: 1,
          splitCounts: { calibration: 72, validation: 24 },
          spectralRange: [900, 1700],
          tags: ["NIR"],
        }}
        className="dataset-card"
        badgeClassName={(badge) => `badge tone-${badge.tone}`}
        statClassName={(stat) => `stat tone-${stat.tone}`}
        statLabelClassName="stat-label"
        statValueClassName="stat-value"
        statDetailClassName="stat-detail"
      />,
    );

    expect(markup).toContain("class=\"dataset-card\"");
    expect(markup).toContain("data-dataset-id=\"soy-v1\"");
    expect(markup).toContain("Soy protein NIR");
    expect(markup).toContain("Regression");
    expect(markup).toContain("900-1,700 nm");
    expect(markup).toContain("Calibration 75%, Validation 25%");
    expect(markup).toContain("96");
    expect(markup).toContain("128");
  });

  it("uses caller-provided renderers and empty content", () => {
    const custom = renderToStaticMarkup(
      <DatasetPreviewCard
        dataset={{ name: "Custom classes", taskType: "classification", sampleCount: 4, classCount: 2 }}
        renderBadge={(badge) => <em>{badge.label}</em>}
        renderStat={(stat) => <span>{stat.id}:{stat.value}</span>}
      />,
    );

    expect(custom).toContain("<em>Classification</em>");
    expect(custom).toContain("classes:2");

    expect(renderToStaticMarkup(<DatasetPreviewCard empty={<span>No dataset</span>} />))
      .toContain("No dataset");
  });
});
