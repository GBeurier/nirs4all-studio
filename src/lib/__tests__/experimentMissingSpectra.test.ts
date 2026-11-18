import { describe, expect, it } from "vitest";

import {
  missingSpectraCounts,
  resolveMissingSpectraChoice,
  savedMissingSpectraChoice,
} from "@/lib/experimentMissingSpectra";
import {
  canProceedNewExperimentStep,
  NEW_EXPERIMENT_DATASETS_STEP,
  NEW_EXPERIMENT_REVIEW_STEP,
} from "@/lib/experimentWizardFlow";

const complete = { id: "a", name: "Complete", num_samples: 120, missing_spectra: null, config: {} };
const gaps = { id: "e", name: "X gaps", num_samples: 120, missing_spectra: { values: 25, samples: 5 }, config: { na_policy: "auto" as const } };
const keptOnPurpose = { ...gaps, id: "k", config: { global_params: { na_policy: "ignore" as const } } };

describe("experimentMissingSpectra", () => {
  it("lists only the datasets that keep missing spectral values", () => {
    expect(missingSpectraCounts([complete, { ...complete, missing_spectra: { values: 0, samples: 0 } }])).toEqual([]);
    expect(missingSpectraCounts([complete, gaps])).toEqual([
      { datasetId: "e", datasetName: "X gaps", samples: 5, values: 25, totalSamples: 120 },
    ]);
  });

  it("preselects nothing unless every affected dataset saved an explicit choice", () => {
    expect(savedMissingSpectraChoice([gaps])).toBeNull();
    expect(savedMissingSpectraChoice([keptOnPurpose, gaps])).toBeNull();
    expect(savedMissingSpectraChoice([complete, keptOnPurpose])).toEqual({ policy: "keep" });
  });

  it("resolves the run's answer: the user's, else the saved one, and none when nothing is asked", () => {
    expect(resolveMissingSpectraChoice({ policy: "remove" }, [complete])).toBeNull();
    expect(resolveMissingSpectraChoice(null, [gaps])).toBeNull();
    expect(resolveMissingSpectraChoice(null, [keptOnPurpose])).toEqual({ policy: "keep" });
    expect(resolveMissingSpectraChoice({ policy: "remove" }, [keptOnPurpose])).toEqual({ policy: "remove" });
  });

  it("holds the review step until the question is answered", () => {
    const step = { selectedPipelineCount: 1, selectedDatasetCount: 1, hasGroupingBlockingError: false };
    expect(canProceedNewExperimentStep({ ...step, currentStep: NEW_EXPERIMENT_REVIEW_STEP, missingSpectraAnswered: false })).toBe(false);
    expect(canProceedNewExperimentStep({ ...step, currentStep: NEW_EXPERIMENT_REVIEW_STEP, missingSpectraAnswered: true })).toBe(true);
    expect(canProceedNewExperimentStep({ ...step, currentStep: NEW_EXPERIMENT_REVIEW_STEP })).toBe(true);
    expect(canProceedNewExperimentStep({ ...step, currentStep: NEW_EXPERIMENT_DATASETS_STEP, missingSpectraAnswered: false })).toBe(true);
  });
});
