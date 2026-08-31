/**
 * nirs4all-ui `viz` domain — the reusable scientific visualization kit.
 *
 * Presentational, dependency-free inline-SVG charts that mirror what nirs4all
 * Studio and the Web/WASM client render: spectra, prediction diagnostics,
 * confusion matrices, distributions, importance/SHAP views, projections,
 * pipeline graphs, and score summaries. Same package boundary as the rest of
 * nirs4all-ui: pure + stateless, NO app state, network/IO, browser globals, or
 * runtime execution. Hosts pass already-computed numeric arrays; each component
 * accepts `className` + color overrides and reads the shared teal palette by
 * default. A default stylesheet ships at `nirs4all-ui/assets/viz.css`.
 *
 * Consumed as `nirs4all-ui/viz`.
 */

// --- palette + pure geometry toolkit ---
export * from "./theme.js";
export * from "./geometry.js";

// --- spectra + dataset ---
export * from "./SpectraPlot.js";
export * from "./Histogram.js";
export * from "./PcaScatter.js";

// --- regression + classification diagnostics ---
export * from "./PredictionScatter.js";
export * from "./ResidualPlot.js";
export * from "./ConformalIntervalStrip.js";
export * from "./ConfusionMatrix.js";
export * from "./BoxPlot.js";
export * from "./ScoreHeatmap.js";
export * from "./FoldStabilityLines.js";
export * from "./BiasVarianceBars.js";

// --- explainability ---
export * from "./FeatureImportanceBar.js";
export * from "./ShapBeeswarm.js";
export * from "./WaterfallChart.js";

// --- pipeline + scores ---
export * from "./PipelineFlow.js";
export * from "./ScoreSummary.js";
