import { describe, expect, it } from "vitest";

import * as tuningFoundation from "./index.js";

describe("nirs4all-ui/tuning barrel", () => {
  it("re-exports tuning result view-model helpers", () => {
    expect(typeof tuningFoundation.parseTuningResultArtifact).toBe("function");
    expect(typeof tuningFoundation.parseTuningSummaryArtifact).toBe("function");
    expect(typeof tuningFoundation.createTuningStudySummary).toBe("function");
    expect(typeof tuningFoundation.createTuningSummaryCard).toBe("function");
    expect(typeof tuningFoundation.createTuningTrialRows).toBe("function");
    expect(typeof tuningFoundation.createTuningSummaryTrialRows).toBe("function");
    expect(typeof tuningFoundation.parseOrderedTuningSearchSpaceArtifact).toBe("function");
    expect(typeof tuningFoundation.createTuningSearchSpacePreview).toBe("function");
    expect(tuningFoundation.TUNING_SUMMARY_FORMAT).toBe("nirs4all.tuning.summary");
    expect(tuningFoundation.TUNING_ORDERED_SEARCH_SPACE_FORMAT).toBe("nirs4all.tuning.ordered_search_space");
    expect(tuningFoundation.normalizeTuningTrialStatus("COMPLETE")).toBe("complete");
  });
});
