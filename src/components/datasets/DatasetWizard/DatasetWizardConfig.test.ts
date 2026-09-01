import { describe, expect, it } from "vitest";

import {
  buildDatasetTargetSelection,
  buildDatasetWizardConfig,
  buildDatasetWizardFiles,
} from "./DatasetWizardConfig";
import { getDetectedFileOverrides } from "./useWizard";
import type { WizardState } from "@/types/datasets";

function createWizardState(overrides: Partial<WizardState> = {}): WizardState {
  return {
    step: "preview",
    sourceType: "folder",
    basePath: "/data/corn",
    datasetName: "corn",
    files: [],
    parsing: {
      delimiter: ";",
      decimal_separator: ".",
      has_header: true,
      header_unit: "cm-1",
      signal_type: "auto",
      na_policy: "auto",
    },
    perFileOverrides: {},
    targets: [],
    defaultTarget: "",
    taskType: "auto",
    aggregation: {
      enabled: false,
      method: "mean",
    },
    preview: null,
    isLoading: false,
    errors: {},
    hasFoldFile: false,
    foldFilePath: null,
    metadataColumns: [],
    confidence: {},
    multiSource: null,
    folds: null,
    fileBlobs: new Map(),
    validatedShapes: {},
    isValidating: false,
    validationError: null,
    ...overrides,
  };
}

describe("DatasetWizardConfig", () => {
  it("hydrates detected non-spectral overrides for preview and persistence", () => {
    expect(getDetectedFileOverrides([
      {
        path: "Xcal.csv",
        filename: "Xcal.csv",
        type: "X",
        split: "train",
        source: null,
        format: "csv",
        size_bytes: 10,
        confidence: 0.9,
        detected: true,
      },
      {
        path: "Mcal.csv",
        filename: "Mcal.csv",
        type: "metadata",
        split: "train",
        source: null,
        format: "csv",
        size_bytes: 10,
        confidence: 0.9,
        detected: true,
        overrides: { has_header: true },
      },
    ])).toEqual({
      "Mcal.csv": { has_header: true },
    });
  });

  it("builds files while dropping unknown roles and preserving per-file overrides", () => {
    const state = createWizardState({
      files: [
        {
          path: "x.csv",
          filename: "x.csv",
          type: "X",
          split: "unknown",
          source: 2,
          format: "csv",
          size_bytes: 10,
          confidence: 0.9,
          detected: true,
        },
        {
          path: "notes.txt",
          filename: "notes.txt",
          type: "unknown",
          split: "unknown",
          source: null,
          format: "csv",
          size_bytes: 10,
          confidence: 0.1,
          detected: false,
        },
      ],
      perFileOverrides: {
        "x.csv": {
          delimiter: ",",
        },
      },
    });

    expect(buildDatasetWizardFiles(state)).toEqual([
      {
        path: "x.csv",
        type: "X",
        split: "train",
        source: 2,
        overrides: {
          delimiter: ",",
        },
      },
    ]);
  });

  it("persists explicit target selection and per-target task types", () => {
    const state = createWizardState({
      targets: [
        { column: "moisture", type: "regression", is_default: true },
        { column: "quality", type: "multiclass_classification" },
      ],
      defaultTarget: "moisture",
      taskType: "regression",
    });

    expect(buildDatasetTargetSelection(state)).toEqual({
      selected_targets: ["moisture", "quality"],
      default_target: "moisture",
      task_by_target: {
        moisture: "regression",
        quality: "multiclass_classification",
      },
    });
  });

  it("keeps multi-source descriptors in the submitted dataset config", () => {
    const state = createWizardState({
      files: [
        {
          path: "source-a-x.csv",
          filename: "source-a-x.csv",
          type: "X",
          split: "train",
          source: 1,
          format: "csv",
          size_bytes: 10,
          confidence: 0.9,
          detected: true,
        },
      ],
      targets: [{ column: "protein", type: "regression", is_default: true }],
      defaultTarget: "protein",
      taskType: "regression",
      multiSource: {
        link_by: "sample_id",
        shared_targets: true,
        sources: [
          {
            id: 1,
            name: "nir",
            files: [],
          },
        ],
      },
    });

    expect(buildDatasetWizardConfig(state)).toMatchObject({
      files: [
        {
          path: "source-a-x.csv",
          type: "X",
          source: 1,
        },
      ],
      multi_source: {
        link_by: "sample_id",
        shared_targets: true,
      },
      target_selection: {
        selected_targets: ["protein"],
        task_by_target: {
          protein: "regression",
        },
      },
      default_target: "protein",
      task_type: "regression",
    });
  });
});
