import { describe, expect, it } from "vitest";

import {
  createConformalCoverageOptions,
  createConformalCoverageStrip,
  createConformalGuaranteeView,
  createConformalGuaranteeViewForArtifact,
  createConformalIntervalSummaryRows,
  createConformalMetricRow,
  createConformalMetricRows,
  createConformalPredictionRows,
  createConformalPredictionRowsFromDagMlPresentation,
  formatCalibrationReplaySource,
  formatConformalCoverage,
  formatTuningCalibrationSource,
  getCalibrationReplaySource,
  getConformalGuaranteeStatus,
  getTuningCalibrationSource,
  isCalibratedRunResultArtifact,
  isCalibrationReplaySource,
  isConformalMetricSet,
  isDagMlConformalPresentationV1,
  isTuningCalibrationSource,
  parseCalibratedRunResultArtifact,
  parseDagMlConformalPresentationV1,
  parseConformalMetricSet,
} from "./result.js";

const calibratedResult = {
  artifact: {
    calibration_size: 4,
    qhat_by_coverage: [{ coverage: 0.8, qhat: 0.5 }],
    spec: {
      coverage: [0.8],
      group_by: [],
      method: "split_absolute_residual",
      multi_target: "marginal",
      unit: "physical_sample",
    },
  },
  fingerprint: "aa019bb722866aa723e41b74ba7d64ba94ae32bc7e739cf264b53e38b57aedf8",
  metadata: {
    conformal_guarantee_status: {
      artifact_fingerprint: "artifact-fp",
      calibrated_coverages: [0.8],
      calibration_data_fingerprint: "calibration-data-fp",
      calibration_replay_source: {
        dataset_backed: true,
        kind: "dataset_predictor_bundle",
        predictor_bundle: "model.n4a",
        requires_model_replay: true,
        route: "nirs4all.predict",
        version: 1,
      },
      coverage: [0.8],
      effective_engine: "nirs4all.conformal.v1",
      guarantee: "split_conformal_marginal_coverage",
      invalidation_reasons: [],
      limitations: [
        "finite-sample marginal coverage requires exchangeable calibration and prediction samples",
        "coverage is not conditional on groups, batches, instruments, or robustness slices",
      ],
      method: "split_absolute_residual",
      multi_target: "marginal",
      predictor_fingerprint: null,
      requested_engine: "nirs4all.conformal.v1",
      scope: "finite_sample_marginal_exchangeability",
      source_calibrated_result_fingerprint: null,
      status: "active",
      unit: "physical_sample",
      version: 1,
    },
    calibration_replay_source: {
      dataset_backed: true,
      kind: "dataset_predictor_bundle",
      predictor_bundle: "model.n4a",
      requires_model_replay: true,
      route: "nirs4all.predict",
      version: 1,
    },
    source: "contract",
    tuning_calibration_source: {
      source: "tuning.winner",
      score_data_role: "hpo_objective_only",
      score_data_used: false,
    },
  },
  prediction: {
    intervals: [{ coverage: 0.8, lower: [0.0, 1.0], qhat: 0.5, upper: [1.0, 2.0] }],
    method: "split_absolute_residual",
    unit: "physical_sample",
    y_pred: [0.5, 1.5],
  },
  sample_ids: ["pred-a", "pred-b"],
  version: 1,
};

const conformalMetric = {
  coverage: 0.8,
  coverage_gap: -0.05,
  fingerprint: "6e92d26975adb97e095c9947f8ac373de132603c198908821a64439cc3fd6b4a",
  mean_interval_score: 1.5,
  mean_width: 1.25,
  median_width: 1,
  n_covered: 3,
  n_missed_above: 0,
  n_missed_below: 1,
  n_samples: 4,
  observed_coverage: 0.75,
  unit: "physical_sample",
  version: 1,
} as const;

const dagMlPresentation = {
  binding_id: "prediction:main",
  calibration_fingerprint: "a".repeat(64),
  intervals: [{ coverage: 0.8, lower: [0, 1], qhat: 0.5, upper: [1, 2] }],
  package_fingerprint: "b".repeat(64),
  point_predictions: [0.5, 1.5],
  presentation_fingerprint: "c".repeat(64),
  replay_outcome_fingerprint: "d".repeat(64),
  sample_ids: ["pred-a", "pred-b"],
  schema_version: 1,
  target_name: "protein",
} as const;

describe("conformal calibrated result view-model helpers", () => {
  it("accepts the DAG-ML presentation contract without recalculating intervals", () => {
    expect(isDagMlConformalPresentationV1(dagMlPresentation)).toBe(true);
    const presentation = parseDagMlConformalPresentationV1(dagMlPresentation);

    expect(createConformalPredictionRowsFromDagMlPresentation(presentation)).toEqual([
      {
        index: 0,
        intervals: [{
          coverage: 0.8,
          coverageLabel: "80%",
          lower: 0,
          lowerLabel: "0.0000",
          upper: 1,
          upperLabel: "1.0000",
          width: 1,
          widthLabel: "1.0000",
        }],
        sampleId: "pred-a",
        yPred: 0.5,
        yPredLabel: "0.5000",
      },
      expect.objectContaining({
        index: 1,
        sampleId: "pred-b",
        yPred: 1.5,
      }),
    ]);
  });

  it("refuses ambiguous or unbounded DAG-ML presentation data", () => {
    expect(() => createConformalPredictionRowsFromDagMlPresentation(parseDagMlConformalPresentationV1({
      ...dagMlPresentation,
      intervals: [{ coverage: 0.8, lower: [null, null], qhat: null, upper: [null, null] }],
    }))).toThrow("unbounded interval");
    expect(() => parseDagMlConformalPresentationV1({
      ...dagMlPresentation,
      sample_ids: ["pred-a", "pred-a"],
    })).toThrow("validated DAG-ML conformal presentation");
    expect(() => parseDagMlConformalPresentationV1({
      ...dagMlPresentation,
      intervals: [{ coverage: 0.8, lower: [0.6, 1], qhat: 0.5, upper: [1, 2] }],
    })).toThrow("validated DAG-ML conformal presentation");
  });

  it("validates the public CalibratedRunResult.to_dict payload shape", () => {
    expect(isCalibratedRunResultArtifact(calibratedResult)).toBe(true);
    expect(parseCalibratedRunResultArtifact(calibratedResult).sample_ids).toEqual(["pred-a", "pred-b"]);
    expect(() =>
      parseCalibratedRunResultArtifact({
        ...calibratedResult,
        prediction: {
          ...calibratedResult.prediction,
          intervals: [{ coverage: 0.8, lower: [0.0], qhat: 0.5, upper: [1.0, 2.0] }],
        },
      }),
    ).toThrow("Expected a nirs4all CalibratedRunResult.to_dict() payload.");
  });

  it("projects guarantee metadata without inferring guarantees from intervals", () => {
    const artifact = parseCalibratedRunResultArtifact(calibratedResult);
    const status = getConformalGuaranteeStatus(artifact);
    const view = createConformalGuaranteeView(status);

    expect(view).toEqual(expect.objectContaining({
      calibrationReplayLabel: "dataset predictor bundle via nirs4all.predict",
      coverageLabel: "80%",
      effectiveEngine: "nirs4all.conformal.v1",
      label: "Active conformal guarantee",
      method: "split_absolute_residual",
      requestedEngine: "nirs4all.conformal.v1",
      scope: "finite_sample_marginal_exchangeability",
      status: "active",
      tone: "success",
      unit: "physical_sample",
    }));
    expect(view.limitations).toContain(
      "finite-sample marginal coverage requires exchangeable calibration and prediction samples",
    );
    expect(view.calibrationReplaySource).toEqual({
      dataset_backed: true,
      kind: "dataset_predictor_bundle",
      predictor_bundle: "model.n4a",
      requires_model_replay: true,
      route: "nirs4all.predict",
      version: 1,
    });
    expect(view.tuningCalibrationLabel).toBe("unknown tuning calibration source");
    expect(view.tuningCalibrationSource).toBeNull();
  });

  it("validates and extracts calibration replay provenance from guarantee metadata", () => {
    const artifact = parseCalibratedRunResultArtifact(calibratedResult);
    const source = getCalibrationReplaySource(artifact);

    expect(source).not.toBeNull();
    expect(source?.kind).toBe("dataset_predictor_bundle");
    expect(source?.requires_model_replay).toBe(true);
    expect(isCalibrationReplaySource(source)).toBe(true);
    expect(formatCalibrationReplaySource({
      dataset_backed: false,
      kind: "replayed_arrays",
      requires_model_replay: false,
      route: "provided_arrays",
      version: 1,
    })).toBe("provided arrays");
  });

  it("validates and formats tuning calibration provenance from result metadata", () => {
    const artifact = parseCalibratedRunResultArtifact(calibratedResult);
    const source = getTuningCalibrationSource(artifact);

    expect(source).not.toBeNull();
    expect(isTuningCalibrationSource(source)).toBe(true);
    expect(source?.source).toBe("tuning.winner");
    expect(formatTuningCalibrationSource(source)).toBe("tuning winner; score_data ranked trials only");
    expect(createConformalGuaranteeViewForArtifact(artifact).tuningCalibrationSource).toEqual(source);
  });

  it("projects metadata-level calibration replay provenance when the guarantee status omits it", () => {
    const artifact = parseCalibratedRunResultArtifact({
      ...calibratedResult,
      metadata: {
        ...calibratedResult.metadata,
        conformal_guarantee_status: {
          ...calibratedResult.metadata.conformal_guarantee_status,
          calibration_replay_source: undefined,
        },
        calibration_replay_source: {
          dataset_backed: false,
          kind: "predict_result",
          requires_model_replay: false,
          route: "PredictResult",
          version: 1,
        },
      },
    });

    expect(getCalibrationReplaySource(artifact)?.kind).toBe("predict_result");
    expect(createConformalGuaranteeViewForArtifact(artifact)).toEqual(expect.objectContaining({
      calibrationReplayLabel: "PredictResult",
      calibrationReplaySource: {
        dataset_backed: false,
        kind: "predict_result",
        requires_model_replay: false,
        route: "PredictResult",
        version: 1,
      },
      label: "Active conformal guarantee",
      status: "active",
    }));
  });

  it("surfaces invalidated and missing guarantee metadata explicitly", () => {
    const activeStatus = getConformalGuaranteeStatus(parseCalibratedRunResultArtifact(calibratedResult));
    if (activeStatus === null) throw new Error("test fixture should include guarantee status");
    const invalidated = createConformalGuaranteeView({
      ...activeStatus,
      invalidation_reasons: ["predictor_fingerprint_changed"],
      status: "invalidated",
    });

    expect(invalidated).toEqual(expect.objectContaining({
      invalidationReasons: ["predictor_fingerprint_changed"],
      label: "Invalidated conformal guarantee",
      status: "invalidated",
      tone: "error",
    }));
    expect(createConformalGuaranteeView(null)).toEqual(expect.objectContaining({
      calibrationReplayLabel: "unknown replay source",
      calibrationReplaySource: null,
      label: "No conformal guarantee metadata",
      status: "unknown",
      tone: "muted",
    }));
  });

  it("rejects malformed calibration replay provenance when present", () => {
    expect(getConformalGuaranteeStatus(parseCalibratedRunResultArtifact({
      ...calibratedResult,
      metadata: {
        ...calibratedResult.metadata,
        conformal_guarantee_status: {
          ...calibratedResult.metadata.conformal_guarantee_status,
          calibration_replay_source: {
            dataset_backed: "yes",
            kind: "dataset_predictor_bundle",
            requires_model_replay: true,
            route: "nirs4all.predict",
            version: 1,
          },
        },
      },
    }))).toBeNull();
  });

  it("summarizes materialized interval widths as display diagnostics only", () => {
    expect(createConformalIntervalSummaryRows(parseCalibratedRunResultArtifact(calibratedResult))).toEqual([
      expect.objectContaining({
        coverage: 0.8,
        coverageLabel: "80%",
        meanWidth: 1,
        nSamples: 2,
        qhat: 0.5,
      }),
    ]);
    expect(formatConformalCoverage(0.955)).toBe("95.5%");
  });

  it("projects prediction rows with materialized intervals per sample", () => {
    expect(createConformalPredictionRows(parseCalibratedRunResultArtifact(calibratedResult))).toEqual([
      {
        index: 0,
        intervals: [
          {
            coverage: 0.8,
            coverageLabel: "80%",
            lower: 0,
            lowerLabel: "0.0000",
            upper: 1,
            upperLabel: "1.0000",
            width: 1,
            widthLabel: "1.0000",
          },
        ],
        sampleId: "pred-a",
        yPred: 0.5,
        yPredLabel: "0.5000",
      },
      {
        index: 1,
        intervals: [
          {
            coverage: 0.8,
            coverageLabel: "80%",
            lower: 1,
            lowerLabel: "1.0000",
            upper: 2,
            upperLabel: "2.0000",
            width: 1,
            widthLabel: "1.0000",
          },
        ],
        sampleId: "pred-b",
        yPred: 1.5,
        yPredLabel: "1.5000",
      },
    ]);

    expect(createConformalPredictionRows(parseCalibratedRunResultArtifact({
      ...calibratedResult,
      sample_ids: [],
    }))[0]?.sampleId).toBeNull();
  });

  it("projects calibrated, selected, and materialized coverage options", () => {
    const artifact = parseCalibratedRunResultArtifact({
      ...calibratedResult,
      metadata: {
        ...calibratedResult.metadata,
        conformal_guarantee_status: {
          ...calibratedResult.metadata.conformal_guarantee_status,
          calibrated_coverages: [0.8, 0.9, 0.95],
          coverage: [0.95],
        },
      },
      prediction: {
        ...calibratedResult.prediction,
        intervals: [
          calibratedResult.prediction.intervals[0],
          { coverage: 0.95, lower: [-0.5, 0.5], qhat: 1, upper: [1.5, 2.5] },
        ],
      },
    });

    expect(createConformalCoverageOptions(artifact)).toEqual([
      {
        calibrated: true,
        coverage: 0.8,
        disabled: false,
        label: "80%",
        materialized: true,
        selected: false,
      },
      {
        calibrated: true,
        coverage: 0.9,
        disabled: true,
        label: "90%",
        materialized: false,
        selected: false,
      },
      {
        calibrated: true,
        coverage: 0.95,
        disabled: false,
        label: "95%",
        materialized: true,
        selected: true,
      },
    ]);
    const strip = createConformalCoverageStrip(
      createConformalCoverageOptions(artifact),
      createConformalIntervalSummaryRows(artifact),
    );
    expect(strip[1]?.positionPercent).toBeCloseTo(66.667, 3);
    expect(strip).toEqual([
      expect.objectContaining({
        coverage: 0.8,
        coverageLabel: "80%",
        meanWidthLabel: "1.0000",
        positionPercent: 0,
        qhatLabel: "0.5000",
        tone: "materialized",
      }),
      expect.objectContaining({
        coverage: 0.9,
        coverageLabel: "90%",
        meanWidthLabel: null,
        qhatLabel: null,
        tone: "calibrated",
      }),
      expect.objectContaining({
        coverage: 0.95,
        coverageLabel: "95%",
        meanWidthLabel: "2.0000",
        positionPercent: 100,
        qhatLabel: "1.0000",
        selected: true,
        tone: "selected",
      }),
    ]);
  });

  it("validates and projects public ConformalMetricSet payloads as diagnostics", () => {
    expect(isConformalMetricSet(conformalMetric)).toBe(true);
    expect(parseConformalMetricSet(conformalMetric).fingerprint).toBe(
      "6e92d26975adb97e095c9947f8ac373de132603c198908821a64439cc3fd6b4a",
    );
    expect(createConformalMetricRow(parseConformalMetricSet(conformalMetric))).toEqual({
      coverage: 0.8,
      coverageGap: -0.05,
      coverageGapDirection: "under",
      coverageGapLabel: "-0.0500",
      coverageLabel: "80%",
      meanIntervalScore: 1.5,
      meanIntervalScoreLabel: "1.5000",
      meanWidth: 1.25,
      meanWidthLabel: "1.2500",
      medianWidth: 1,
      medianWidthLabel: "1.0000",
      missedAbove: 0,
      missedBelow: 1,
      nCovered: 3,
      nSamples: 4,
      observedCoverage: 0.75,
      observedCoverageLabel: "75%",
      unit: "physical_sample",
    });
    expect(createConformalMetricRows([
      { ...conformalMetric, coverage: 0.95, observed_coverage: 1, coverage_gap: 0.05 },
      conformalMetric,
    ]).map((row) => row.coverage)).toEqual([0.8, 0.95]);
  });

  it("rejects inconsistent ConformalMetricSet counts", () => {
    expect(() => parseConformalMetricSet({ ...conformalMetric, n_covered: 4 })).toThrow(
      "Expected a nirs4all ConformalMetricSet.to_dict() payload.",
    );
  });
});
