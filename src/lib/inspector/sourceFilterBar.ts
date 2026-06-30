import type { InspectorDataFilters } from '@/types/inspector';

export const INSPECTOR_ALL_FILTER_VALUE = '__all__';

export type InspectorSourceArrayFilterKey =
  | 'run_ids'
  | 'dataset_names'
  | 'model_classes'
  | 'preprocessings';

export type InspectorSourceValueFilterKey = 'task_type' | 'metric';

export interface InspectorSourceFacetFilterModel {
  id: InspectorSourceArrayFilterKey;
  labelKey: string;
  defaultLabel: string;
  values: string[];
  selected: string[];
}

export interface InspectorSourceSelectOption {
  value: string;
  label: string;
}

export interface InspectorSourceSelectFilterModel {
  id: InspectorSourceValueFilterKey;
  placeholder: string;
  value: string;
  options: InspectorSourceSelectOption[];
}

export interface InspectorSourceFilterBarModel {
  facets: InspectorSourceFacetFilterModel[];
  taskType: InspectorSourceSelectFilterModel;
  metric: InspectorSourceSelectFilterModel | null;
  hasFilters: boolean;
  chainCountLabel: string;
}

export interface BuildInspectorSourceFilterBarModelInput {
  filters: InspectorDataFilters;
  availableRuns: string[];
  availableDatasets: string[];
  availableModels: string[];
  availablePreprocessings: string[];
  availableMetrics: string[];
  totalChains: number;
  isLoading: boolean;
}

export const INSPECTOR_TASK_TYPE_FILTER_OPTIONS = [
  { value: INSPECTOR_ALL_FILTER_VALUE, label: 'All Types' },
  { value: 'regression', label: 'Regression' },
  { value: 'classification', label: 'Classification' },
] as const;

export function patchInspectorSourceFilters(
  filters: InspectorDataFilters,
  patch: Partial<InspectorDataFilters>,
): InspectorDataFilters {
  return { ...filters, ...patch };
}

export function getOptionalInspectorFilterArray(values: string[]): string[] | undefined {
  return values.length ? values : undefined;
}

export function getOptionalInspectorFilterValue(value: string): string | undefined {
  return value === INSPECTOR_ALL_FILTER_VALUE ? undefined : value;
}

export function patchInspectorSourceArrayFilter(
  filters: InspectorDataFilters,
  key: InspectorSourceArrayFilterKey,
  values: string[],
): InspectorDataFilters {
  return patchInspectorSourceFilters(filters, {
    [key]: getOptionalInspectorFilterArray(values),
  });
}

export function patchInspectorSourceValueFilter(
  filters: InspectorDataFilters,
  key: InspectorSourceValueFilterKey,
  value: string,
): InspectorDataFilters {
  return patchInspectorSourceFilters(filters, {
    [key]: getOptionalInspectorFilterValue(value),
  });
}

export function hasInspectorSourceFilters(filters: InspectorDataFilters): boolean {
  return Boolean(
    filters.run_ids?.length ||
    filters.dataset_names?.length ||
    filters.model_classes?.length ||
    filters.preprocessings?.length ||
    filters.task_type ||
    filters.metric,
  );
}

export function toggleInspectorFacetValue(selected: readonly string[], value: string): string[] {
  return selected.includes(value)
    ? selected.filter(v => v !== value)
    : [...selected, value];
}

export function getInspectorChainCountLabel(isLoading: boolean, totalChains: number): string {
  return isLoading ? '...' : `${totalChains} chains`;
}

export function buildInspectorSourceFilterBarModel({
  filters,
  availableRuns,
  availableDatasets,
  availableModels,
  availablePreprocessings,
  availableMetrics,
  totalChains,
  isLoading,
}: BuildInspectorSourceFilterBarModelInput): InspectorSourceFilterBarModel {
  return {
    facets: [
      {
        id: 'run_ids',
        labelKey: 'inspector.filter.runs',
        defaultLabel: 'Runs',
        values: availableRuns,
        selected: filters.run_ids ?? [],
      },
      {
        id: 'dataset_names',
        labelKey: 'inspector.filter.datasets',
        defaultLabel: 'Datasets',
        values: availableDatasets,
        selected: filters.dataset_names ?? [],
      },
      {
        id: 'model_classes',
        labelKey: 'inspector.filter.models',
        defaultLabel: 'Models',
        values: availableModels,
        selected: filters.model_classes ?? [],
      },
      {
        id: 'preprocessings',
        labelKey: 'inspector.filter.preprocessing',
        defaultLabel: 'Preprocessing',
        values: availablePreprocessings,
        selected: filters.preprocessings ?? [],
      },
    ],
    taskType: {
      id: 'task_type',
      placeholder: 'Type',
      value: filters.task_type ?? INSPECTOR_ALL_FILTER_VALUE,
      options: [...INSPECTOR_TASK_TYPE_FILTER_OPTIONS],
    },
    metric: availableMetrics.length > 0
      ? {
          id: 'metric',
          placeholder: 'Metric',
          value: filters.metric ?? INSPECTOR_ALL_FILTER_VALUE,
          options: [
            { value: INSPECTOR_ALL_FILTER_VALUE, label: 'All Metrics' },
            ...availableMetrics.map(metric => ({ value: metric, label: metric })),
          ],
        }
      : null,
    hasFilters: hasInspectorSourceFilters(filters),
    chainCountLabel: getInspectorChainCountLabel(isLoading, totalChains),
  };
}
