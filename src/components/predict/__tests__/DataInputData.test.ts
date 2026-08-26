import { describe, expect, it } from "vitest";

import {
  buildDataInputDatasetReadModel,
  buildDataInputFileReadModel,
  buildDataInputModelReadModel,
  buildDataInputSourceTabs,
  buildDataSourceConfig,
  formatDataInputPartitionLabel,
  getDataInputCanSubmit,
  isAcceptedDataInputFile,
  parsePastedSpectra,
} from "../DataInputData";
import type { AvailableModel } from "@/types/predict";

function model(overrides: Partial<AvailableModel> = {}): AvailableModel {
  return {
    id: "model",
    name: "PLS tuned",
    source: "chain",
    model_class: "PLSRegression",
    dataset_name: "Corn",
    metric: "rmse",
    best_score: 0.21,
    created_at: null,
    file_size: null,
    preprocessing: "SNV",
    bundle_path: null,
    ...overrides,
  };
}

describe("DataInputData", () => {
  it("builds source tabs and disables them until a model is selected", () => {
    expect(buildDataInputSourceTabs(false).map((source) => [source.id, source.disabled])).toEqual([
      ["dataset", true],
      ["upload", true],
      ["paste", true],
    ]);
    expect(buildDataInputSourceTabs(true).map((source) => [source.id, source.disabled])).toEqual([
      ["dataset", false],
      ["upload", false],
      ["paste", false],
    ]);
    expect(buildDataInputSourceTabs(true, "native_archive").map((source) => [source.id, source.disabled])).toEqual([
      ["dataset", true],
      ["upload", false],
      ["paste", true],
    ]);
  });

  it("builds dataset, partition, and file labels", () => {
    expect(buildDataInputDatasetReadModel([
      { id: "corn", name: "Corn" },
      { id: "wheat", name: null },
    ])).toEqual({
      options: [
        { id: "corn", label: "Corn" },
        { id: "wheat", label: "wheat" },
      ],
      availabilityLabel: "2 linked datasets available.",
    });
    expect(formatDataInputPartitionLabel("all")).toBe("All partitions");
    expect(formatDataInputPartitionLabel("external")).toBe("External");
    expect(buildDataInputFileReadModel({ name: "spectra.csv", size: 1536 })).toEqual({
      name: "spectra.csv",
      sizeLabel: "1.5 KB",
    });
    expect(isAcceptedDataInputFile({ name: "spectra.CSV" })).toBe(true);
    expect(isAcceptedDataInputFile({ name: "spectra.txt" })).toBe(false);
  });

  it("parses pasted spectra from JSON, CSV, semicolon, and TSV text", () => {
    expect(parsePastedSpectra("[1, 2, 3]")).toEqual([[1, 2, 3]]);
    expect(parsePastedSpectra("[[1, 2], [3, 4]]")).toEqual([[1, 2], [3, 4]]);
    expect(parsePastedSpectra("1,2,3\n4,5,6")).toEqual([[1, 2, 3], [4, 5, 6]]);
    expect(parsePastedSpectra("1; 2; 3\r\n4; 5; 6")).toEqual([[1, 2, 3], [4, 5, 6]]);
    expect(parsePastedSpectra("1\t2\t3\n4\t5\t6")).toEqual([[1, 2, 3], [4, 5, 6]]);
  });

  it("rejects empty, non-numeric, and incomplete pasted spectra", () => {
    expect(parsePastedSpectra("")).toBeNull();
    expect(parsePastedSpectra("[[1, 2], [3, \"x\"]]")).toBeNull();
    expect(parsePastedSpectra("1,2\n3,nope")).toBeNull();
    expect(parsePastedSpectra("1,,2")).toBeNull();
  });

  it("evaluates submit readiness by selected source", () => {
    const base = {
      isModelSelected: true,
      isLoading: false,
      datasetId: "",
      file: null,
      pasteText: "",
    };

    expect(getDataInputCanSubmit({ ...base, isModelSelected: false, tab: "dataset", datasetId: "d1" })).toBe(false);
    expect(getDataInputCanSubmit({ ...base, isLoading: true, tab: "dataset", datasetId: "d1" })).toBe(false);
    expect(getDataInputCanSubmit({ ...base, tab: "dataset", datasetId: "d1" })).toBe(true);
    expect(getDataInputCanSubmit({ ...base, tab: "upload", file: { name: "spectra.csv" } as File })).toBe(true);
    expect(getDataInputCanSubmit({ ...base, tab: "paste", pasteText: "1,2,3" })).toBe(true);
    expect(getDataInputCanSubmit({
      ...base,
      modelSource: "native_archive",
      tab: "dataset",
      datasetId: "d1",
    })).toBe(false);
    expect(getDataInputCanSubmit({
      ...base,
      modelSource: "native_archive",
      tab: "upload",
      file: { name: "spectra.csv" } as File,
    })).toBe(true);
  });

  it("builds submit configs for dataset, file, and pasted arrays", () => {
    const file = { name: "spectra.csv", size: 1024 } as File;

    expect(buildDataSourceConfig({
      tab: "dataset",
      datasetId: "corn",
      partition: "test",
      file: null,
      pasteText: "",
    })).toEqual({
      ok: true,
      config: { type: "dataset", datasetId: "corn", partition: "test" },
    });
    expect(buildDataSourceConfig({
      tab: "upload",
      datasetId: "",
      partition: "test",
      file,
      pasteText: "",
    })).toEqual({
      ok: true,
      config: { type: "file", file },
    });
    expect(buildDataSourceConfig({
      tab: "paste",
      datasetId: "",
      partition: "test",
      file: null,
      pasteText: "1,2\n3,4",
    })).toEqual({
      ok: true,
      config: { type: "array", spectra: [[1, 2], [3, 4]] },
    });
    expect(buildDataSourceConfig({
      tab: "paste",
      datasetId: "",
      partition: "test",
      file: null,
      pasteText: "nope",
    })).toEqual({ ok: false, reason: "invalid-paste" });
  });

  it("builds the model read-model with badges and metric pills", () => {
    expect(buildDataInputModelReadModel(null)).toMatchObject({
      isSelected: false,
      title: "Model required",
      badges: [],
      pills: [],
    });

    const readModel = buildDataInputModelReadModel(model({
      prediction_metric: "rmse",
      prediction_score: 0.23456,
    }));

    expect(readModel).toMatchObject({
      isSelected: true,
      title: "PLS tuned",
      badges: [
        { key: "source", label: "chain", variant: "outline" },
        { key: "model-class", label: "PLSRegression", variant: "secondary" },
        { key: "dataset", label: "Corn", variant: "outline" },
      ],
    });
    expect(readModel.pills.map((pill) => pill.label)).toEqual([
      "Prediction: RMSEP 0.235",
      "SNV",
    ]);
  });
});
