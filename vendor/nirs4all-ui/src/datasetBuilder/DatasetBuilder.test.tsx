import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DatasetBuilder } from "./DatasetBuilder.js";
import type { DatasetSource } from "./types.js";

function sampleSource(): DatasetSource {
  return {
    id: "s1",
    name: "wheat_spectra_train.csv",
    kind: "file",
    fileType: "csv",
    signalType: "spectra",
    status: "parsed",
    rowCount: 12048,
    columnCount: 5,
    parsing: { separator: ";", decimal: ".", headerMode: "horizontal" },
    usage: { useAs: "x_train" },
    columns: [
      { id: "sample_id", name: "sample_id", detectedType: "text", assignedRole: "ignored", previewValue: "S00123" },
      { id: "replicate", name: "replicate", detectedType: "integer", assignedRole: "ignored", previewValue: 1 },
      { id: "split", name: "split", detectedType: "text", assignedRole: "ignored", previewValue: "train" },
      { id: "wavelength_1000", name: "wavelength_1000", detectedType: "float", assignedRole: "ignored", previewValue: 0.234 },
      { id: "wavelength_1001", name: "wavelength_1001", detectedType: "float", assignedRole: "ignored", previewValue: 0.236 },
    ],
  };
}

describe("DatasetBuilder", () => {
  it("renders the empty drop zone with no sources", () => {
    const html = renderToStaticMarkup(<DatasetBuilder />);
    expect(html).toContain("dsb__dropzone");
    expect(html).toContain("Dataset Builder");
  });

  it("renders the wizard and auto-detects roles on a spectra source", () => {
    const html = renderToStaticMarkup(<DatasetBuilder defaultSources={[sampleSource()]} />);
    expect(html).toContain("wheat_spectra_train.csv");
    // stepper + role cards + config assistant present
    expect(html).toContain("dsb-stepper");
    expect(html).toContain("dsb-role-card");
    expect(html).toContain("Assistant de configuration");
    // auto-detection put sample_id as an ID role select value
    expect(html).toContain("Construction du dataset");
  });

  it("renders in English when asked", () => {
    const html = renderToStaticMarkup(<DatasetBuilder defaultSources={[sampleSource()]} locale="en" />);
    expect(html).toContain("Dataset construction");
    expect(html).toContain("Configuration assistant");
  });
});
