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
import i18n from 'i18next';
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
import type { PlaygroundDataViewProjection } from '@/lib/playground/dataViewProjection';
import {
  buildPlaygroundChartAvailabilityReadModel,
  type PlaygroundChartAvailabilityContext,
  getPlaygroundChartDisabledReason,
  isPlaygroundChartAvailable,
  isPlaygroundChartDisabled,
  isPlaygroundChartId,
  shouldRecommendPlaygroundChart,
  type PlaygroundChartId,
} from '@/lib/playground/chartAvailability';
import { useTranslation } from 'react-i18next';

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
  /** Display name shown in UI (custom charts; built-in charts use nameKey) */
  name?: string;
  /** i18n key of the display name */
  nameKey?: string;
  /** Short name for compact displays */
  shortName?: string;
  /** i18n key of the short name */
  shortNameKey?: string;
  /** Description for tooltips */
  description?: string;
  /** i18n key of the description */
  descriptionKey?: string;
  /** Icon component (Lucide icon) */
  icon: LucideIcon;
  /** Chart component to render */
  component: ComponentType<Record<string, unknown>>; // Will be passed BaseChartProps + specific props
  /** Check if this chart should be available given the full chart availability context. */
  requiresDataContext?: (
    context: PlaygroundChartAvailabilityContext,
  ) => boolean;
  /** Legacy availability callback. Prefer requiresDataContext for new chart extensions. */
  requiresData?: (
    result: PlaygroundResult | null,
    rawData: SpectralData | null,
    dataView?: PlaygroundDataViewProjection | null,
  ) => boolean;
  /** Check if this chart is disabled using the full chart availability context. */
  isDisabledContext?: (
    context: PlaygroundChartAvailabilityContext,
  ) => boolean;
  /** Legacy disabled callback. Prefer isDisabledContext for new chart extensions. */
  isDisabled?: (
    result: PlaygroundResult | null,
    rawData: SpectralData | null,
    dataView?: PlaygroundDataViewProjection | null,
  ) => boolean;
  /** Reason why the chart is disabled using the full chart availability context. */
  disabledReasonContext?: (
    context: PlaygroundChartAvailabilityContext,
  ) => string | null;
  /** Legacy disabled-reason callback. Prefer disabledReasonContext for new chart extensions. */
  disabledReason?: (
    result: PlaygroundResult | null,
    rawData: SpectralData | null,
    dataView?: PlaygroundDataViewProjection | null,
  ) => string | null;
  /** Default visibility (shown by default) */
  defaultVisible: boolean;
  /** Priority for ordering (lower = higher priority) */
  priority: number;
  /** Category for grouping */
  category: 'core' | 'analysis' | 'advanced';
  /** Minimum data requirements description */
  dataRequirements?: string;
  /** i18n key of the data requirements description */
  dataRequirementsKey?: string;
}

/**
 * Chart visibility state
 */
export type ChartVisibility = Record<string, boolean>;

export type ChartAvailabilityInput = PlaygroundResult | PlaygroundChartAvailabilityContext | null;

function isRegisteredPlaygroundChartId(id: string): id is PlaygroundChartId {
  return isPlaygroundChartId(id);
}

function isPlaygroundChartAvailabilityContext(
  value: ChartAvailabilityInput,
): value is PlaygroundChartAvailabilityContext {
  return Boolean(value && typeof value === 'object' && 'result' in value && 'rawData' in value);
}

function toPlaygroundChartAvailabilityContext(
  resultOrContext: ChartAvailabilityInput,
  rawData?: SpectralData | null,
  dataView?: PlaygroundDataViewProjection | null,
): PlaygroundChartAvailabilityContext {
  if (isPlaygroundChartAvailabilityContext(resultOrContext)) {
    return resultOrContext;
  }

  return {
    result: resultOrContext,
    rawData: rawData ?? null,
    dataView,
  };
}

function toPlaygroundChartRegistryContext(
  resultOrContext: ChartAvailabilityInput,
  rawData?: SpectralData | null,
  dataView?: PlaygroundDataViewProjection | null,
): PlaygroundChartAvailabilityContext {
  const context = toPlaygroundChartAvailabilityContext(resultOrContext, rawData, dataView);
  if (context.availability) {
    return context;
  }
  return {
    ...context,
    availability: buildPlaygroundChartAvailabilityReadModel(context),
  };
}

/** Resolve a chart text from an i18n key (at call time) or a literal fallback. */
function resolveChartText(key: string | undefined, text: string | undefined): string | undefined {
  return key ? i18n.t(key) : text;
}

// ============= Chart Definitions =============

/**
 * Core chart definitions
 */
export const CHART_DEFINITIONS: ChartDefinition[] = [
  {
    id: 'spectra',
    nameKey: 'playground.chartRegistry.spectra.name',
    shortNameKey: 'playground.chartRegistry.spectra.shortName',
    descriptionKey: 'playground.chartRegistry.spectra.description',
    icon: Layers,
    component: () => null, // Placeholder - actual component passed at render time
    requiresData: (result, rawData, dataView) => isPlaygroundChartAvailable('spectra', { result, rawData, dataView }),
    defaultVisible: true,
    priority: 10,
    category: 'core',
    dataRequirementsKey: 'playground.chartRegistry.spectra.dataRequirements',
  },
  {
    id: 'histogram',
    nameKey: 'playground.chartRegistry.histogram.name',
    shortNameKey: 'playground.chartRegistry.histogram.shortName',
    descriptionKey: 'playground.chartRegistry.histogram.description',
    icon: BarChart2,
    component: () => null,
    requiresData: (result, rawData, dataView) => isPlaygroundChartAvailable('histogram', { result, rawData, dataView }),
    isDisabled: (result, rawData, dataView) => isPlaygroundChartDisabled('histogram', { result, rawData, dataView }),
    disabledReason: (result, rawData, dataView) => getPlaygroundChartDisabledReason('histogram', { result, rawData, dataView }),
    defaultVisible: true,
    priority: 20,
    category: 'core',
    dataRequirementsKey: 'playground.chartRegistry.histogram.dataRequirements',
  },
  {
    id: 'pca',
    nameKey: 'playground.chartRegistry.pca.name',
    shortNameKey: 'playground.chartRegistry.pca.shortName',
    descriptionKey: 'playground.chartRegistry.pca.description',
    icon: ScatterChart,
    component: () => null,
    requiresData: (result, rawData, dataView) => isPlaygroundChartAvailable('pca', { result, rawData, dataView }),
    defaultVisible: true,
    priority: 30,
    category: 'core',
    dataRequirementsKey: 'playground.chartRegistry.pca.dataRequirements',
  },
  {
    id: 'folds',
    nameKey: 'playground.chartRegistry.folds.name',
    shortNameKey: 'playground.chartRegistry.folds.shortName',
    descriptionKey: 'playground.chartRegistry.folds.description',
    icon: LayoutGrid,
    component: () => null,
    requiresData: (result, rawData, dataView) => isPlaygroundChartAvailable('folds', { result, rawData, dataView }),
    isDisabled: (result, rawData, dataView) => isPlaygroundChartDisabled('folds', { result, rawData, dataView }),
    disabledReason: (result, rawData, dataView) => getPlaygroundChartDisabledReason('folds', { result, rawData, dataView }),
    defaultVisible: true,
    priority: 40,
    category: 'core',
    dataRequirementsKey: 'playground.chartRegistry.folds.dataRequirements',
  },
  {
    id: 'repetitions',
    nameKey: 'playground.chartRegistry.repetitions.name',
    shortNameKey: 'playground.chartRegistry.repetitions.shortName',
    descriptionKey: 'playground.chartRegistry.repetitions.description',
    icon: Repeat,
    component: () => null,
    requiresData: (result, rawData, dataView) => isPlaygroundChartAvailable('repetitions', { result, rawData, dataView }),
    isDisabled: (result, rawData, dataView) => isPlaygroundChartDisabled('repetitions', { result, rawData, dataView }),
    disabledReason: (result, rawData, dataView) => getPlaygroundChartDisabledReason('repetitions', { result, rawData, dataView }),
    defaultVisible: false, // Not visible by default until reps detected
    priority: 50,
    category: 'analysis',
    dataRequirementsKey: 'playground.chartRegistry.repetitions.dataRequirements',
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
  getAvailable(
    result: ChartAvailabilityInput,
    rawData?: SpectralData | null,
    dataView?: PlaygroundDataViewProjection | null,
  ): ChartDefinition[] {
    const context = toPlaygroundChartRegistryContext(result, rawData, dataView);
    return this.getAll().filter(chart => this.isAvailable(chart.id, context));
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
  isAvailable(
    id: string,
    result: ChartAvailabilityInput,
    rawData?: SpectralData | null,
    dataView?: PlaygroundDataViewProjection | null,
  ): boolean {
    const chart = this.get(id);
    if (!chart) return false;
    const context = toPlaygroundChartRegistryContext(result, rawData, dataView);
    if (isRegisteredPlaygroundChartId(id)) {
      return isPlaygroundChartAvailable(id, context);
    }
    return chart.requiresDataContext?.(context)
      ?? chart.requiresData?.(context.result, context.rawData, context.dataView)
      ?? false;
  }

  /**
   * Check if a specific chart is disabled
   */
  isDisabled(
    id: string,
    result: ChartAvailabilityInput,
    rawData?: SpectralData | null,
    dataView?: PlaygroundDataViewProjection | null,
  ): boolean {
    const chart = this.get(id);
    if (!chart) return true;
    const context = toPlaygroundChartRegistryContext(result, rawData, dataView);
    if (isRegisteredPlaygroundChartId(id)) {
      return isPlaygroundChartDisabled(id, context);
    }
    return chart.isDisabledContext?.(context)
      ?? chart.isDisabled?.(context.result, context.rawData, context.dataView)
      ?? false;
  }

  /**
   * Get the reason a chart is disabled
   */
  getDisabledReason(
    id: string,
    result: ChartAvailabilityInput,
    rawData?: SpectralData | null,
    dataView?: PlaygroundDataViewProjection | null,
  ): string | null {
    const chart = this.get(id);
    if (!chart) return i18n.t('playground.chartRegistry.notFound');
    const context = toPlaygroundChartRegistryContext(result, rawData, dataView);
    if (isRegisteredPlaygroundChartId(id)) {
      return getPlaygroundChartDisabledReason(id, context);
    }
    return chart.disabledReasonContext?.(context)
      ?? chart.disabledReason?.(context.result, context.rawData, context.dataView)
      ?? null;
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
  result: ChartAvailabilityInput,
  rawData?: SpectralData | null,
  dataView?: PlaygroundDataViewProjection | null,
): ChartVisibility {
  const effective: ChartVisibility = { ...visibility };
  const context = toPlaygroundChartRegistryContext(result, rawData, dataView);

  for (const id of Object.keys(visibility)) {
    const chart = chartRegistry.get(id);
    if (!chart) continue;

    // If chart requires specific data that's not available, hide it
    if (!chartRegistry.isAvailable(id, context)) {
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
  result: ChartAvailabilityInput,
  rawData?: SpectralData | null,
  dataView?: PlaygroundDataViewProjection | null,
): ChartVisibility {
  const recommended: ChartVisibility = { ...current };
  const context = toPlaygroundChartRegistryContext(result, rawData, dataView);

  // Enable repetitions chart when repetitions are detected
  if (shouldRecommendPlaygroundChart('repetitions', context) && !current.repetitions) {
    recommended.repetitions = true;
  }

  // Enable folds chart when a splitter is added
  if (shouldRecommendPlaygroundChart('folds', context) && !current.folds) {
    recommended.folds = true;
  }

  return recommended;
}

/**
 * Get list of chart IDs that should show toggle buttons
 */
export function getToggleableCharts(
  result: ChartAvailabilityInput,
  rawData?: SpectralData | null,
  dataView?: PlaygroundDataViewProjection | null,
): { id: string; label: string; disabled: boolean; disabledReason: string | null }[] {
  const context = toPlaygroundChartRegistryContext(result, rawData, dataView);

  return chartRegistry.getAll().map(chart => ({
    id: chart.id,
    label: resolveChartText(chart.shortNameKey, chart.shortName) || resolveChartText(chart.nameKey, chart.name) || chart.id,
    disabled: chartRegistry.isDisabled(chart.id, context),
    disabledReason: chartRegistry.getDisabledReason(chart.id, context),
  }));
}

export default chartRegistry;
