/**
 * Inspector panel definitions registry.
 */

import { ScatterChart, Table2, BarChart3, TrendingDown, Grid3X3, CandlestickChart, GitCompare, GitBranch, Activity, Grid2X2, Radar, BarChartHorizontal, Layers, SlidersHorizontal, Scale, TrendingUp, type LucideIcon } from 'lucide-react';
import type { InspectorPanelType } from '@/types/inspector';

export interface InspectorPanelDefinition {
  id: InspectorPanelType;
  name: string;
  shortName: string;
  icon: LucideIcon;
  defaultVisible: boolean;
  priority: number;
}

export const INSPECTOR_PANELS: InspectorPanelDefinition[] = [
  {
    id: 'rankings',
    name: 'Rankings Table',
    shortName: 'Rankings',
    icon: Table2,
    defaultVisible: true,
    priority: 10,
  },
  {
    id: 'heatmap',
    name: 'Performance Heatmap',
    shortName: 'Heatmap',
    icon: Grid3X3,
    defaultVisible: true,
    priority: 15,
  },
  {
    id: 'histogram',
    name: 'Score Distribution',
    shortName: 'Histogram',
    icon: BarChart3,
    defaultVisible: true,
    priority: 20,
  },
  {
    id: 'candlestick',
    name: 'Score Box Plot',
    shortName: 'Box Plot',
    icon: CandlestickChart,
    defaultVisible: true,
    priority: 25,
  },
  {
    id: 'scatter',
    name: 'Predicted vs Observed',
    shortName: 'Scatter',
    icon: ScatterChart,
    defaultVisible: true,
    priority: 30,
  },
  {
    id: 'preprocessing_impact',
    name: 'Preprocessing Impact',
    shortName: 'Preproc',
    icon: Layers,
    defaultVisible: true,
    priority: 35,
  },
  {
    id: 'residuals',
    name: 'Residuals Plot',
    shortName: 'Residuals',
    icon: TrendingDown,
    defaultVisible: false,
    priority: 40,
  },
  {
    id: 'branch_comparison',
    name: 'Branch Comparison',
    shortName: 'Branches',
    icon: GitCompare,
    defaultVisible: false,
    priority: 45,
  },
  {
    id: 'fold_stability',
    name: 'Fold Stability',
    shortName: 'Folds',
    icon: Activity,
    defaultVisible: false,
    priority: 50,
  },
  {
    id: 'confusion',
    name: 'Confusion Matrix',
    shortName: 'Confusion',
    icon: Grid2X2,
    defaultVisible: false,
    priority: 55,
  },
  {
    id: 'branch_topology',
    name: 'Branch Topology',
    shortName: 'Topology',
    icon: GitBranch,
    defaultVisible: false,
    priority: 60,
  },
  {
    id: 'robustness',
    name: 'Robustness Radar',
    shortName: 'Robustness',
    icon: Radar,
    defaultVisible: false,
    priority: 65,
  },
  {
    id: 'correlation',
    name: 'Metric Correlation',
    shortName: 'Correlation',
    icon: BarChartHorizontal,
    defaultVisible: false,
    priority: 70,
  },
  {
    id: 'hyperparameter',
    name: 'Hyperparameter Sensitivity',
    shortName: 'Hyperparam',
    icon: SlidersHorizontal,
    defaultVisible: false,
    priority: 75,
  },
  {
    id: 'bias_variance',
    name: 'Bias-Variance Decomposition',
    shortName: 'Bias-Var',
    icon: Scale,
    defaultVisible: false,
    priority: 80,
  },
  {
    id: 'learning_curve',
    name: 'Learning Curve',
    shortName: 'Learning',
    icon: TrendingUp,
    defaultVisible: false,
    priority: 85,
  },
];

export const PANEL_MAP = new Map(INSPECTOR_PANELS.map(p => [p.id, p]));
