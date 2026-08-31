import { describe, expect, it } from "vitest";

import * as datasetFoundation from "./index.js";

describe("nirs4all-ui/dataset barrel", () => {
  it("re-exports dataset preview helpers", () => {
    expect(typeof datasetFoundation.parseDatasetCount).toBe("function");
    expect(typeof datasetFoundation.formatDatasetCount).toBe("function");
    expect(typeof datasetFoundation.resolveDatasetTaskKind).toBe("function");
    expect(typeof datasetFoundation.formatDatasetTaskLabel).toBe("function");
    expect(typeof datasetFoundation.formatDatasetTokenLabel).toBe("function");
    expect(typeof datasetFoundation.normalizeDatasetSplitCounts).toBe("function");
    expect(typeof datasetFoundation.formatDatasetSpectralRange).toBe("function");
    expect(typeof datasetFoundation.buildDatasetPreview).toBe("function");
  });

  it("wires the preview builder through the barrel", () => {
    expect(datasetFoundation.buildDatasetPreview({
      name: "Tablet blend",
      taskType: "classification",
      sampleCount: 42,
      classCount: 3,
    })).toMatchObject({
      title: "Tablet blend",
      taskKind: "classification",
      classCountLabel: "3 classes",
    });
  });
});
