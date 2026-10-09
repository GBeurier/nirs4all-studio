/**
 * Inspector panel definitions registry.
 */

import { ScatterChart, Table2, BarChart3, TrendingDown, Grid3X3, CandlestickChart, GitCompare, GitBranch, Activity, Grid2X2, Layers, SlidersHorizontal, Scale, type LucideIcon } from 'lucide-react';
import type { InspectorPanelType } from '@/types/inspector';

export interface InspectorPanelDefinition {
  id: InspectorPanelType;
  nameKey: string;
  /** Stable English identifier used in exported file names (not displayed). */
  shortName: string;
  icon: LucideIcon;
  defaultVisible: boolean;
  priority: number;
  helpKey: string;
}

export const INSPECTOR_PANELS: InspectorPanelDefinition[] = [
  {
    id: 'rankings',
    nameKey: 'inspector.panelDefs.rankings.name',
    shortName: 'Rankings',
    icon: Table2,
    defaultVisible: true,
    priority: 10,
    helpKey: 'inspector.panelDefs.rankings.help',
  },
  {
    id: 'heatmap',
    nameKey: 'inspector.panelDefs.heatmap.name',
    shortName: 'Heatmap',
    icon: Grid3X3,
    defaultVisible: true,
    priority: 15,
    helpKey: 'inspector.panelDefs.heatmap.help',
  },
  {
    id: 'histogram',
    nameKey: 'inspector.panelDefs.histogram.name',
    shortName: 'Histogram',
    icon: BarChart3,
    defaultVisible: true,
    priority: 20,
    helpKey: 'inspector.panelDefs.histogram.help',
  },
  {
    id: 'candlestick',
    nameKey: 'inspector.panelDefs.candlestick.name',
    shortName: 'Box Plot',
    icon: CandlestickChart,
    defaultVisible: true,
    priority: 25,
    helpKey: 'inspector.panelDefs.candlestick.help',
  },
  {
    id: 'scatter',
    nameKey: 'inspector.panelDefs.scatter.name',
    shortName: 'Scatter',
    icon: ScatterChart,
    defaultVisible: true,
    priority: 30,
    helpKey: 'inspector.panelDefs.scatter.help',
  },
  {
    id: 'preprocessing_impact',
    nameKey: 'inspector.panelDefs.preprocessing_impact.name',
    shortName: 'Preproc',
    icon: Layers,
    defaultVisible: true,
    priority: 35,
    helpKey: 'inspector.panelDefs.preprocessing_impact.help',
  },
  {
    id: 'residuals',
    nameKey: 'inspector.panelDefs.residuals.name',
    shortName: 'Residuals',
    icon: TrendingDown,
    defaultVisible: false,
    priority: 40,
    helpKey: 'inspector.panelDefs.residuals.help',
  },
  {
    id: 'branch_comparison',
    nameKey: 'inspector.panelDefs.branch_comparison.name',
    shortName: 'Branches',
    icon: GitCompare,
    defaultVisible: false,
    priority: 45,
    helpKey: 'inspector.panelDefs.branch_comparison.help',
  },
  {
    id: 'fold_stability',
    nameKey: 'inspector.panelDefs.fold_stability.name',
    shortName: 'Folds',
    icon: Activity,
    defaultVisible: false,
    priority: 50,
    helpKey: 'inspector.panelDefs.fold_stability.help',
  },
  {
    id: 'confusion',
    nameKey: 'inspector.panelDefs.confusion.name',
    shortName: 'Confusion',
    icon: Grid2X2,
    defaultVisible: false,
    priority: 55,
    helpKey: 'inspector.panelDefs.confusion.help',
  },
  {
    id: 'branch_topology',
    nameKey: 'inspector.panelDefs.branch_topology.name',
    shortName: 'Topology',
    icon: GitBranch,
    defaultVisible: false,
    priority: 60,
    helpKey: 'inspector.panelDefs.branch_topology.help',
  },
  {
    id: 'hyperparameter',
    nameKey: 'inspector.panelDefs.hyperparameter.name',
    shortName: 'Hyperparam',
    icon: SlidersHorizontal,
    defaultVisible: false,
    priority: 75,
    helpKey: 'inspector.panelDefs.hyperparameter.help',
  },
  {
    id: 'bias_variance',
    nameKey: 'inspector.panelDefs.bias_variance.name',
    shortName: 'Bias-Var',
    icon: Scale,
    defaultVisible: false,
    priority: 80,
    helpKey: 'inspector.panelDefs.bias_variance.help',
  },
];

export const PANEL_MAP = new Map(INSPECTOR_PANELS.map(p => [p.id, p]));
