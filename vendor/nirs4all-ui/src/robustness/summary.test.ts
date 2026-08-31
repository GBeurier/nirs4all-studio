import { describe, expect, it } from "vitest";

import {
  ROBUSTNESS_SUMMARY_FORMAT,
  ROBUSTNESS_SUMMARY_SCHEMA_VERSION,
  createRobustnessDegradationHeatmap,
  createRobustnessDegradationRows,
  createRobustnessGuaranteeView,
  createRobustnessSummaryCards,
  createRobustnessWorstSliceRows,
  formatSignedRobustnessSummaryMetric,
  formatRobustnessSummaryMetric,
  getRobustnessDegradationTone,
  getRobustnessCoverageStatus,
  getRobustnessConformalGuaranteeStatus,
  getRobustnessSpectralReplay,
  isRobustnessSummaryArtifact,
  parseRobustnessSummaryArtifact,
  type ConformalGuaranteeStatus,
  type RobustnessSummaryArtifact,
  type RobustnessSpectralReplay,
  type RobustnessSummaryRow,
} from "./summary.js";

function row(overrides: Partial<RobustnessSummaryRow> = {}): RobustnessSummaryRow {
  return {
    bias: 0.01,
    conformal_max_abs_coverage_gap: 0.02,
    conformal_mean_width_mean: 0.31,
    conformal_min_observed_coverage: 0.95,
    delta_bias: 0,
    delta_mae: 0,
    delta_max_abs_error: 0,
    delta_rmse: 0,
    execution_scope: "baseline",
    mae: 0.12,
    mae_ratio: 1,
    max_abs_error: 0.42,
    n_samples: 24,
    requires_spectral_replay: false,
    rmse: 0.18,
    rmse_ratio: 1,
    scenario: { kind: "observed" },
    scenario_index: 0,
    scenario_label: "observed",
    severity: 0,
    worst_slice_key: { batch: "A" },
    worst_slice_label: "batch=A",
    worst_slice_metric: "rmse",
    worst_slice_value: 0.18,
    ...overrides,
  };
}

function artifact(overrides: Partial<RobustnessSummaryArtifact> = {}): RobustnessSummaryArtifact {
  return {
    fingerprint: "robustness:abc123",
    format: ROBUSTNESS_SUMMARY_FORMAT,
    mode: "clean_frozen",
    report_version: 1,
    schema_version: ROBUSTNESS_SUMMARY_SCHEMA_VERSION,
    slice_by: ["batch"],
    summary: [row()],
    ...overrides,
  };
}

const guaranteeStatus: ConformalGuaranteeStatus = {
  artifact_fingerprint: "artifact:123",
  calibrated_coverages: [0.8, 0.9],
  calibration_data_fingerprint: "calibration:123",
  coverage: [0.8],
  effective_engine: "nirs4all.python.replayed_array_apply",
  guarantee: "split_conformal_marginal_coverage",
  invalidation_reasons: ["predictor fingerprint changed"],
  limitations: ["finite-sample marginal coverage requires exchangeability"],
  method: "split_absolute_residual",
  multi_target: "marginal",
  predictor_fingerprint: "predictor:123",
  requested_engine: "nirs4all.conformal.v1",
  scope: "finite_sample_marginal_exchangeability",
  source_calibrated_result_fingerprint: null,
  status: "invalidated",
  unit: "physical_sample",
  version: 1,
};

const spectralReplay: RobustnessSpectralReplay = {
  all_predictions: false,
  predictor_bundle: "model.n4a",
  route: "nirs4all.predict",
  sample_ids_forwarded: true,
  source: "predictor_bundle",
};

describe("robustness summary artifact helpers", () => {
  it("accepts the native summary.json contract and preserves forward-compatible row keys", () => {
    const payload = artifact({
      conformal_guarantee_status: guaranteeStatus,
      spectral_replay: spectralReplay,
      summary: [row({ extra_contract_field: "kept" })],
    });

    expect(isRobustnessSummaryArtifact(payload)).toBe(true);
    expect(parseRobustnessSummaryArtifact(payload)).toBe(payload);
    expect(getRobustnessConformalGuaranteeStatus(payload)).toBe(guaranteeStatus);
    expect(getRobustnessSpectralReplay(payload)).toBe(spectralReplay);
    expect(createRobustnessSummaryCards(payload)[0]?.executionScope).toBe("baseline");
    expect(createRobustnessSummaryCards(payload)[0]?.requiresSpectralReplay).toBe(false);
    expect(payload.summary[0]?.extra_contract_field).toBe("kept");
  });

  it("rejects unsupported formats, schema versions, and incomplete rows", () => {
    expect(isRobustnessSummaryArtifact(artifact({ format: "other" as typeof ROBUSTNESS_SUMMARY_FORMAT }))).toBe(false);
    expect(isRobustnessSummaryArtifact(artifact({ schema_version: 2 as typeof ROBUSTNESS_SUMMARY_SCHEMA_VERSION }))).toBe(false);
    expect(isRobustnessSummaryArtifact(artifact({ summary: [{ ...row(), rmse: Number.NaN }] }))).toBe(false);
    expect(isRobustnessSummaryArtifact(artifact({ summary: [{ ...row(), execution_scope: "local_replay" } as unknown as RobustnessSummaryRow] }))).toBe(false);
    expect(isRobustnessSummaryArtifact(artifact({ summary: [{ ...row(), requires_spectral_replay: "yes" } as unknown as RobustnessSummaryRow] }))).toBe(false);
    expect(isRobustnessSummaryArtifact(artifact({
      conformal_guarantee_status: {
        ...guaranteeStatus,
        coverage: [Number.NaN],
      },
    }))).toBe(false);
    expect(isRobustnessSummaryArtifact(artifact({
      spectral_replay: {
        ...spectralReplay,
        source: "bundle",
      } as unknown as RobustnessSpectralReplay,
    }))).toBe(false);
    expect(isRobustnessSummaryArtifact(artifact({
      spectral_replay: {
        ...spectralReplay,
        sample_ids_forwarded: "yes",
      } as unknown as RobustnessSpectralReplay,
    }))).toBe(false);

    expect(() => parseRobustnessSummaryArtifact({})).toThrow(TypeError);
  });

  it("keeps spectral replay provenance optional and independent from row metrics", () => {
    expect(getRobustnessSpectralReplay(artifact())).toBeNull();
    expect(getRobustnessSpectralReplay(artifact({
      spectral_replay: {
        route: "predictor.predict_or_callable",
        sample_ids_forwarded: false,
        source: "predictor",
      },
    }))).toEqual({
      route: "predictor.predict_or_callable",
      sample_ids_forwarded: false,
      source: "predictor",
    });
  });

  it("projects optional conformal guarantee metadata into a shared badge view", () => {
    const view = createRobustnessGuaranteeView(artifact({
      conformal_guarantee_status: guaranteeStatus,
    }));

    expect(view).toMatchObject({
      coverageLabel: "80%",
      effectiveEngine: "nirs4all.python.replayed_array_apply",
      invalidationReasons: ["predictor fingerprint changed"],
      label: "Invalidated conformal guarantee",
      method: "split_absolute_residual",
      requestedEngine: "nirs4all.conformal.v1",
      status: "invalidated",
      tone: "error",
      unit: "physical_sample",
    });
    expect(createRobustnessGuaranteeView(artifact()).status).toBe("unknown");
  });

  it("projects rows into compact Studio/Web card view-models", () => {
    const cards = createRobustnessSummaryCards(artifact({
      summary: [
        row(),
        row({
          conformal_max_abs_coverage_gap: 0.12,
          conformal_min_observed_coverage: 0.85,
          delta_mae: 0.03,
          delta_rmse: 0.04,
          scenario: { distribution: "uniform", kind: "prediction_noise" },
          scenario_index: 1,
          scenario_label: "prediction noise (distribution=uniform)",
          severity: 0.4,
        }),
        row({
          conformal_max_abs_coverage_gap: 0.25,
          conformal_min_observed_coverage: 0.75,
          scenario_index: 2,
          scenario_label: "severe drift",
          severity: 0.9,
        }),
      ],
    }));

    expect(cards).toMatchObject([
      { distribution: null, scenario: { kind: "observed" }, scenarioLabel: "observed", status: "ok" },
      {
        distribution: "uniform",
        maeDelta: 0.03,
        rmseDelta: 0.04,
        scenario: { distribution: "uniform", kind: "prediction_noise" },
        scenarioLabel: "prediction noise (distribution=uniform)",
        status: "warning",
      },
      { scenarioLabel: "severe drift", status: "critical" },
    ]);
  });

  it("keeps conformal status unknown when no conformal coverage fields are present", () => {
    expect(getRobustnessCoverageStatus(row({
      conformal_max_abs_coverage_gap: null,
      conformal_min_observed_coverage: null,
    }))).toBe("unknown");
  });

  it("formats nullable metric values for compact labels", () => {
    expect(formatRobustnessSummaryMetric(null)).toBe("—");
    expect(formatRobustnessSummaryMetric(0.123456, 2)).toBe("0.12");
    expect(formatSignedRobustnessSummaryMetric(0.123456, 2)).toBe("+0.12");
    expect(formatSignedRobustnessSummaryMetric(-0.123456, 2)).toBe("-0.12");
  });

  it("projects summary cards into shared degradation rows", () => {
    const rows = createRobustnessDegradationRows(createRobustnessSummaryCards(artifact({
      summary: [
        row({
          delta_mae: -0.02,
          delta_rmse: -0.04,
          scenario_index: 0,
          scenario_label: "improved correction",
        }),
        row({
          conformal_max_abs_coverage_gap: 0.12,
          conformal_min_observed_coverage: 0.85,
          delta_mae: 0.03,
          delta_rmse: 0.04,
          scenario_index: 1,
          scenario_label: "detector drift",
        }),
      ],
    })));

    expect(getRobustnessDegradationTone(-0.1)).toBe("improved");
    expect(getRobustnessDegradationTone(0)).toBe("unchanged");
    expect(getRobustnessDegradationTone(0.1)).toBe("worse");
    expect(rows).toEqual([
      {
        coverageStatus: "ok",
        coverageStatusLabel: "Coverage OK",
        maeDelta: -0.02,
        maeDeltaLabel: "-0.02",
        maeDeltaTone: "improved",
        rmseDelta: -0.04,
        rmseDeltaLabel: "-0.04",
        rmseDeltaTone: "improved",
        scenarioIndex: 0,
        scenarioLabel: "improved correction",
        worstSliceLabel: "batch=A",
      },
      {
        coverageStatus: "warning",
        coverageStatusLabel: "Coverage warning",
        maeDelta: 0.03,
        maeDeltaLabel: "+0.03",
        maeDeltaTone: "worse",
        rmseDelta: 0.04,
        rmseDeltaLabel: "+0.04",
        rmseDeltaTone: "worse",
        scenarioIndex: 1,
        scenarioLabel: "detector drift",
        worstSliceLabel: "batch=A",
      },
    ]);
  });

  it("projects summary cards into normalized degradation heatmap cells", () => {
    const cards = createRobustnessSummaryCards(artifact({
      summary: [
        row({
          conformal_max_abs_coverage_gap: 0,
          delta_mae: -0.01,
          delta_rmse: -0.02,
          scenario_index: 0,
          scenario_label: "improved correction",
        }),
        row({
          conformal_max_abs_coverage_gap: 0.2,
          delta_mae: 0.03,
          delta_rmse: 0.04,
          scenario_index: 1,
          scenario_label: "prediction noise",
        }),
        row({
          conformal_max_abs_coverage_gap: null,
          delta_mae: 0,
          delta_rmse: 0,
          scenario_index: 2,
          scenario_label: "unmeasured coverage",
        }),
      ],
    }));

    expect(createRobustnessDegradationHeatmap(cards, ["rmse_delta", "coverage_gap"])).toEqual([
      expect.objectContaining({
        intensity: 0.5,
        metric: "rmse_delta",
        scenarioLabel: "improved correction",
        tone: "improved",
        valueLabel: "-0.02",
      }),
      expect.objectContaining({
        intensity: 0,
        metric: "coverage_gap",
        scenarioLabel: "improved correction",
        tone: "unchanged",
        valueLabel: "0",
      }),
      expect.objectContaining({
        intensity: 1,
        metric: "rmse_delta",
        scenarioLabel: "prediction noise",
        tone: "worse",
        valueLabel: "+0.04",
      }),
      expect.objectContaining({
        intensity: 1,
        metric: "coverage_gap",
        scenarioLabel: "prediction noise",
        tone: "worse",
        valueLabel: "0.2",
      }),
      expect.objectContaining({
        intensity: 0,
        metric: "rmse_delta",
        scenarioLabel: "unmeasured coverage",
        tone: "unchanged",
        valueLabel: "0",
      }),
      expect.objectContaining({
        intensity: 0,
        metric: "coverage_gap",
        scenarioLabel: "unmeasured coverage",
        tone: "unknown",
        valueLabel: "—",
      }),
    ]);
  });

  it("projects summary cards into shared worst-slice rows", () => {
    const rows = createRobustnessWorstSliceRows(createRobustnessSummaryCards(artifact({
      summary: [
        row({
          scenario_index: 0,
          scenario_label: "prediction noise",
          worst_slice_key: { batch: "A" },
          worst_slice_label: "batch=A",
          worst_slice_metric: "rmse",
          worst_slice_value: 0.18,
        }),
        row({
          scenario_index: 1,
          scenario_label: "no slice diagnostics",
          worst_slice_key: null,
          worst_slice_label: null,
          worst_slice_metric: "rmse",
          worst_slice_value: null,
        }),
      ],
    })));

    expect(rows).toEqual([
      {
        available: true,
        metric: "rmse",
        scenarioIndex: 0,
        scenarioLabel: "prediction noise",
        sliceKey: { batch: "A" },
        sliceLabel: "batch=A",
        value: 0.18,
        valueLabel: "0.18",
      },
      {
        available: false,
        metric: "rmse",
        scenarioIndex: 1,
        scenarioLabel: "no slice diagnostics",
        sliceKey: null,
        sliceLabel: null,
        value: null,
        valueLabel: "—",
      },
    ]);
  });
});
