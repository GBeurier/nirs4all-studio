/**
 * Inspector panel definitions registry.
 */

import { ScatterChart, Table2, BarChart3, TrendingDown, Grid3X3, CandlestickChart, GitCompare, GitBranch, Activity, Grid2X2, Layers, SlidersHorizontal, Scale, type LucideIcon } from 'lucide-react';
import type { InspectorPanelType } from '@/types/inspector';

export interface InspectorPanelDefinition {
  id: InspectorPanelType;
  name: string;
  shortName: string;
  icon: LucideIcon;
  defaultVisible: boolean;
  priority: number;
  help: string;
}

export const INSPECTOR_PANELS: InspectorPanelDefinition[] = [
  {
    id: 'rankings',
    name: 'Rankings Table',
    shortName: 'Rankings',
    icon: Table2,
    defaultVisible: true,
    priority: 10,
    help: 'Ranks chains for the active score column. Use this to identify the strongest candidates before drilling into diagnostics.',
  },
  {
    id: 'heatmap',
    name: 'Performance Heatmap',
    shortName: 'Heatmap',
    icon: Grid3X3,
    defaultVisible: true,
    priority: 15,
    help: 'Summarizes score by the chosen grouping variables. It is useful for spotting interactions between models, preprocessings, and datasets.',
  },
  {
    id: 'histogram',
    name: 'Score Distribution',
    shortName: 'Histogram',
    icon: BarChart3,
    defaultVisible: true,
    priority: 20,
    help: 'Shows the empirical distribution of scores across the current scope. Use it to detect multimodality, skew, and outliers.',
  },
  {
    id: 'candlestick',
    name: 'Score Box Plot',
    shortName: 'Box Plot',
    icon: CandlestickChart,
    defaultVisible: true,
    priority: 25,
    help: 'Compares score spread within each category. This is the quickest view for stability, dispersion, and extreme values.',
  },
  {
    id: 'scatter',
    name: 'Predicted vs Observed',
    shortName: 'Scatter',
    icon: ScatterChart,
    defaultVisible: true,
    priority: 30,
    help: 'Compares predicted values to ground truth. Deviations from the diagonal usually reveal bias, saturation, or a poor fit.',
  },
  {
    id: 'preprocessing_impact',
    name: 'Preprocessing Impact',
    shortName: 'Preproc',
    icon: Layers,
    defaultVisible: true,
    priority: 35,
    help: 'Estimates whether a preprocessing step is associated with better or worse scores across the visible chains.',
  },
  {
    id: 'residuals',
    name: 'Residuals Plot',
    shortName: 'Residuals',
    icon: TrendingDown,
    defaultVisible: false,
    priority: 40,
    help: 'Focuses on prediction error rather than raw score. Structure in the residual cloud indicates systematic modeling issues.',
  },
  {
    id: 'branch_comparison',
    name: 'Branch Comparison',
    shortName: 'Branches',
    icon: GitCompare,
    defaultVisible: false,
    priority: 45,
    help: 'Compares branch-level performance when a pipeline splits into several modeling paths. Use it to locate the branch that drives gains.',
  },
  {
    id: 'fold_stability',
    name: 'Fold Stability',
    shortName: 'Folds',
    icon: Activity,
    defaultVisible: false,
    priority: 50,
    help: 'Shows how scores vary across folds for the focused chains. Large fold-to-fold spread suggests brittle generalization.',
  },
  {
    id: 'confusion',
    name: 'Confusion Matrix',
    shortName: 'Confusion',
    icon: Grid2X2,
    defaultVisible: false,
    priority: 55,
    help: 'Available for classification tasks. It exposes which classes are being confused instead of hiding the error behind a single metric.',
  },
  {
    id: 'branch_topology',
    name: 'Branch Topology',
    shortName: 'Topology',
    icon: GitBranch,
    defaultVisible: false,
    priority: 60,
    help: 'Shows the structure of a single pipeline branch graph. This helps connect a performance pattern back to the underlying pipeline topology.',
  },
  {
    id: 'hyperparameter',
    name: 'Hyperparameter Sensitivity',
    shortName: 'Hyperparam',
    icon: SlidersHorizontal,
    defaultVisible: false,
    priority: 75,
    help: 'Plots numeric hyperparameters against score. A visible trend suggests the tuned parameter carries signal; a cloud suggests weak sensitivity.',
  },
  {
    id: 'bias_variance',
    name: 'Bias-Variance Decomposition',
    shortName: 'Bias-Var',
    icon: Scale,
    defaultVisible: false,
    priority: 80,
    help: 'Separates error into bias and variance components for regression chains. Use it to determine whether the model is underfitting or unstable.',
  },
];

export const PANEL_MAP = new Map(INSPECTOR_PANELS.map(p => [p.id, p]));
