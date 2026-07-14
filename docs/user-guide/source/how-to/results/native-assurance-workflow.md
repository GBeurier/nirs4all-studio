# Review Native Assurance Results

This guide shows how to review native nirs4all tuning, conformal prediction, and robustness artifacts in Studio after a run has completed. Use it when you want to verify what was requested, what nirs4all actually produced, and which evidence is still missing before a robustness replay can run.

## Prerequisites

- You have completed a run that used native tuning, conformal prediction, or robustness metadata.
- The run is visible on the Results page or the Predictions page.
- For spectral/OOD robustness replay, the selected prediction must carry row-aligned `X` spectra and a frozen predictor reference such as a `predictor_bundle` or saved `model_path`.

## Steps

1. **Open the result detail panel.** Go to **Results**, select the relevant dataset or run, and open the result detail panel for the chain you want to inspect.

2. **Check Native tuning.** If the run produced a native tuning artifact, Studio shows a **Native tuning** section.

   | Field | Meaning |
   |---|---|
   | **Engine** | The optimizer backend recorded by nirs4all, for example Optuna or n4m. |
   | **Best params** | Parameters selected by the native optimizer. Studio displays them; it does not replay the optimizer. |
   | **Sampler / pruner / seed** | Optional optimizer metadata published by the tuning artifact. |
   | **Persistence** | Resume/storage/study metadata. Studio does not display the raw storage URI. |

3. **Check Conformal prediction.** If the chain includes a native `CalibratedRunResult`, Studio shows **Conformal prediction** in Results and Chain Detail.

   | Field | Meaning |
   |---|---|
   | **Guarantee badge** | Active/invalidated guarantee status from `conformal_guarantee_status`, including selected coverage, effective engine, requested-engine mismatch, and limitations when present. |
   | **Coverage strip** | Visual markers for calibrated or materialized coverage levels. |
   | **Intervals** | Bounds produced by nirs4all for the selected coverage. |
   | **Coverage metrics** | Attached empirical coverage rows such as observed coverage, gap, interval score, misses above/below, and width. |
   | **Metrics CSV** | Exports the displayed empirical coverage rows without recomputing them. |

4. **Open Chain Detail for prediction-level evidence.** From Results or Predictions, open the chain detail panel. The prediction preview and full viewer can display conformal intervals as error bars when the artifact includes materialized bounds.

5. **Review the Robustness launch plan.** When a run transported a native `robustness` payload, Studio shows **Robustness launch plan** before a report exists. This section records the requested mode, scenarios, severities, distributions, slices, and optional spectral/OOD evidence-publication request.

6. **Run or inspect a robustness report.** In Chain Detail, use **Native robustness report** for stored-prediction scenarios such as `observed`, `prediction_bias`, or `prediction_noise`. Spectral/OOD scenarios appear only when the evidence preflight finds row-aligned spectra and a frozen predictor reference.

   | Scenario family | Required evidence | Effect |
   |---|---|---|
   | `observed` | Stored `y_true` and `y_pred` | Baseline audit with severity forced to `0`. |
   | `prediction_bias` | Stored `y_true` and `y_pred` | Adds a deterministic prediction offset. |
   | `prediction_noise` | Stored `y_true` and `y_pred` | Adds seeded prediction noise; `normal` uses severity as sigma, `uniform` uses `[-severity, +severity]`. |
   | Spectral/OOD scenarios | Stored `y_true`, `y_pred`, row-aligned `X`, and frozen predictor replay evidence | Delegates spectral perturbation and replay to nirs4all. |

7. **Read Robustness summary.** Once nirs4all has produced a verified report, Studio shows **Robustness summary** with scenario cards, degradation heatmap, degradation matrix, worst slices, guarantee metadata when present, and report exports.

## Boundary rules

Studio displays native artifacts and can ask the backend to call nirs4all for a report. It does not:

- run the optimizer locally;
- recalibrate conformal predictors;
- create new interval levels;
- infer a guarantee from plotted intervals or partial metrics;
- recompute observed coverage, interval scores, robustness metrics, or worst slices;
- synthesize missing `y_true`, spectra, sample alignment, or predictor bundles.

If a section is missing, inspect the result JSON and artifact list first: the native artifact may not have been attached, or required replay evidence may not have been published.

## What's Next

- {doc}`../../reference/pipeline-editor-page` -- configure native tuning and robustness launch metadata.
- {doc}`../../reference/results-page` -- field-by-field reference for Results and Chain Detail.
- {doc}`../../reference/predictions-page` -- inspect prediction intervals and exports.
- {doc}`export-predictions` -- export visible conformal intervals to CSV.
