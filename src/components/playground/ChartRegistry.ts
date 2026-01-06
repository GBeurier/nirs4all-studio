/**
 * ChartRegistry - Extensible registry for playground charts (Phase 4)
 *
 * Provides a clean, extensible interface for adding new chart types to the
 * playground. Each chart is registered with:
 * - Unique ID and display name
 * - Icon component
 * - Component to render
 * - Data requirements check
 * - Default visibility
 *
 * This registry pattern makes it easy to:
 * - Add new chart types without modifying MainCanvas
 * - Dynamically enable/disable charts based on data availability
 * - Maintain consistent chart configuration
 */

import { ComponentType } from 'react';
import {
  Layers,
  BarChart2,
  LayoutGrid,
  ScatterChart,
  Repeat,
  Grid3X3,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import type { PlaygroundResult } from '@/types/playground';
import type { SpectralData } from '@/types/spectral';

// ============= Types =============

/**
 * Base props that all chart components receive
 */
export interface BaseChartProps {
  /** Playground execution result */
  result: PlaygroundResult | null;
  /** Raw spectral data */
  rawData: SpectralData | null;
  /** Y values */
  y?: number[];
  /** Whether chart is in loading state */
  isLoading?: boolean;
  /** Use SelectionContext for cross-chart selection */
  useSelectionContext?: boolean;
  /** Compact mode (less chrome, smaller) */
  compact?: boolean;
}

/**
 * Chart definition for registry
 */
export interface ChartDefinition {
  /** Unique identifier for the chart */
  id: string;
  /** Display name shown in UI */
  name: string;
  /** Short name for compact displays */
  shortName?: string;
  /** Description for tooltips */
  description?: string;
  /** Icon component (Lucide icon) */
  icon: LucideIcon;
  /** Chart component to render */
  component: ComponentType<any>; // Will be passed BaseChartProps + specific props
  /** Check if this chart should be available given the data */
  requiresData: (result: PlaygroundResult | null, rawData: SpectralData | null) => boolean;
  /** Check if this chart is disabled (available but not functional) */
  isDisabled?: (result: PlaygroundResult | null, rawData: SpectralData | null) => boolean;
  /** Reason why the chart is disabled */
  disabledReason?: (result: PlaygroundResult | null, rawData: SpectralData | null) => string | null;
  /** Default visibility (shown by default) */
  defaultVisible: boolean;
  /** Priority for ordering (lower = higher priority) */
  priority: number;
  /** Category for grouping */
  category: 'core' | 'analysis' | 'advanced';
  /** Minimum data requirements description */
  dataRequirements?: string;
}

/**
 * Chart visibility state
 */
export type ChartVisibility = Record<string, boolean>;

// ============= Chart Definitions =============

/**
 * Core chart definitions
 */
export const CHART_DEFINITIONS: ChartDefinition[] = [
  {
    id: 'spectra',
    name: 'Spectra Chart',
    shortName: 'Spectra',
    description: 'Visualize original and processed spectral data with overlay',
    icon: Layers,
    component: () => null, // Placeholder - actual component passed at render time
    requiresData: (result, rawData) => {
      return (result?.processed?.spectra?.length ?? 0) > 0 || (rawData?.spectra?.length ?? 0) > 0;
    },
    defaultVisible: true,
    priority: 10,
    category: 'core',
    dataRequirements: 'Spectral data (X)',
  },
  {
    id: 'histogram',
    name: 'Y Histogram',
    shortName: 'Y Hist',
    description: 'Distribution of target values with fold coloring',
    icon: BarChart2,
    component: () => null,
    requiresData: (result, rawData) => {
      return (rawData?.y?.length ?? 0) > 0;
    },
    isDisabled: (result, rawData) => (rawData?.y?.length ?? 0) === 0,
    disabledReason: () => 'No Y values in dataset',
    defaultVisible: true,
    priority: 20,
    category: 'core',
    dataRequirements: 'Target values (Y)',
  },
  {
    id: 'pca',
    name: 'Dimension Reduction',
    shortName: 'PCA/UMAP',
    description: 'PCA or UMAP projection of spectral data',
    icon: ScatterChart,
    component: () => null,
    requiresData: (result) => {
      return !!result?.pca?.coordinates && result.pca.coordinates.length > 0;
    },
    defaultVisible: true,
    priority: 30,
    category: 'core',
    dataRequirements: 'PCA computation enabled',
  },
  {
    id: 'folds',
    name: 'Fold Distribution',
    shortName: 'Folds',
    description: 'Cross-validation fold sample counts and Y statistics',
    icon: LayoutGrid,
    component: () => null,
    requiresData: (result) => {
      return !!result?.folds && result.folds.n_folds > 0;
    },
    isDisabled: (result) => !result?.folds || result.folds.n_folds === 0,
    disabledReason: () => 'Add a splitter to see folds',
    defaultVisible: true,
    priority: 40,
    category: 'core',
    dataRequirements: 'Splitter in pipeline',
  },
  {
    id: 'repetitions',
    name: 'Repetitions Chart',
    shortName: 'Reps',
    description: 'Visualize intra-sample variability between repetitions',
    icon: Repeat,
    component: () => null,
    requiresData: (result) => {
      return !!result?.repetitions;
    },
    isDisabled: (result) => !result?.repetitions?.has_repetitions,
    disabledReason: (result) => {
      if (!result?.repetitions) return 'Repetition analysis not computed';
      if (!result.repetitions.has_repetitions) {
        return result.repetitions.message || 'No repetitions detected in dataset';
      }
      return null;
    },
    defaultVisible: false, // Not visible by default until reps detected
    priority: 50,
    category: 'analysis',
    dataRequirements: 'Sample IDs with repetition patterns',
  },
];

// ============= Registry Class =============

/**
 * Chart Registry provides methods for managing chart definitions
 */
class ChartRegistryClass {
  private charts: Map<string, ChartDefinition> = new Map();

  constructor() {
    // Register default charts
    CHART_DEFINITIONS.forEach(chart => this.register(chart));
  }

  /**
   * Register a new chart definition
   */
  register(definition: ChartDefinition): void {
    this.charts.set(definition.id, definition);
  }

  /**
   * Unregister a chart by ID
   */
  unregister(id: string): boolean {
    return this.charts.delete(id);
  }

  /**
   * Get a chart definition by ID
   */
  get(id: string): ChartDefinition | undefined {
    return this.charts.get(id);
  }

  /**
   * Get all registered charts
   */
  getAll(): ChartDefinition[] {
    return Array.from(this.charts.values()).sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get charts filtered by category
   */
  getByCategory(category: ChartDefinition['category']): ChartDefinition[] {
    return this.getAll().filter(chart => chart.category === category);
  }

  /**
   * Get available charts based on current data
   */
  getAvailable(result: PlaygroundResult | null, rawData: SpectralData | null): ChartDefinition[] {
    return this.getAll().filter(chart => chart.requiresData(result, rawData));
  }

  /**
   * Get default visibility map
   */
  getDefaultVisibility(): ChartVisibility {
    const visibility: ChartVisibility = {};
    this.getAll().forEach(chart => {
      visibility[chart.id] = chart.defaultVisible;
    });
    return visibility;
  }

  /**
   * Check if a specific chart is available
   */
  isAvailable(id: string, result: PlaygroundResult | null, rawData: SpectralData | null): boolean {
    const chart = this.get(id);
    if (!chart) return false;
    return chart.requiresData(result, rawData);
  }

  /**
   * Check if a specific chart is disabled
   */
  isDisabled(id: string, result: PlaygroundResult | null, rawData: SpectralData | null): boolean {
    const chart = this.get(id);
    if (!chart) return true;
    return chart.isDisabled?.(result, rawData) ?? false;
  }

  /**
   * Get the reason a chart is disabled
   */
  getDisabledReason(id: string, result: PlaygroundResult | null, rawData: SpectralData | null): string | null {
    const chart = this.get(id);
    if (!chart) return 'Chart not found';
    return chart.disabledReason?.(result, rawData) ?? null;
  }
}

// ============= Singleton Export =============

/**
 * Global chart registry instance
 */
export const chartRegistry = new ChartRegistryClass();

// ============= Utility Functions =============

/**
 * Get chart configuration for a specific chart type
 */
export function getChartConfig(id: string): ChartDefinition | undefined {
  return chartRegistry.get(id);
}

/**
 * Build visibility map with disabled charts removed
 */
export function buildEffectiveVisibility(
  visibility: ChartVisibility,
  result: PlaygroundResult | null,
  rawData: SpectralData | null
): ChartVisibility {
  const effective: ChartVisibility = { ...visibility };

  for (const [id, isVisible] of Object.entries(visibility)) {
    const chart = chartRegistry.get(id);
    if (!chart) continue;

    // If chart requires specific data that's not available, hide it
    if (!chart.requiresData(result, rawData)) {
      effective[id] = false;
    }
  }

  return effective;
}

/**
 * Compute recommended visibility based on data
 * Auto-enables charts when their data becomes available
 */
export function computeRecommendedVisibility(
  current: ChartVisibility,
  result: PlaygroundResult | null,
  rawData: SpectralData | null
): ChartVisibility {
  const recommended: ChartVisibility = { ...current };

  // Enable repetitions chart when repetitions are detected
  if (result?.repetitions?.has_repetitions && !current.repetitions) {
    recommended.repetitions = true;
  }

  // Enable folds chart when a splitter is added
  if (result?.folds && result.folds.n_folds > 0 && !current.folds) {
    recommended.folds = true;
  }

  return recommended;
}

/**
 * Get list of chart IDs that should show toggle buttons
 */
export function getToggleableCharts(
  result: PlaygroundResult | null,
  rawData: SpectralData | null
): { id: string; label: string; disabled: boolean; disabledReason: string | null }[] {
  return chartRegistry.getAll().map(chart => ({
    id: chart.id,
    label: chart.shortName || chart.name,
    disabled: chart.isDisabled?.(result, rawData) ?? false,
    disabledReason: chart.disabledReason?.(result, rawData) ?? null,
  }));
}

export default chartRegistry;
