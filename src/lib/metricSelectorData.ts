import {
  getAvailableMetrics,
  getMetricDefinitions,
  getPresetsForTaskType,
  getPresetsForTaskTypes,
  groupMetricDefinitions,
  type MetricDefinition,
  type MetricGroup,
  type MetricPreset,
} from '@/lib/scores';
import { canonicalMetricKey } from '@/lib/metricKeys';
import { formatMetricDisplayName, isLowerBetter } from '@/lib/scoreValues';

type MetricSelectorGroup = MetricGroup | 'custom';

export interface MetricSelectorMetricDefinition extends MetricDefinition {
  isCustom?: boolean;
}

export interface MetricSelectorSection {
  group: MetricSelectorGroup;
  label: string;
  metrics: MetricSelectorMetricDefinition[];
}

export interface MetricSelectorData {
  selectedCount: number;
  availableSections: MetricSelectorSection[];
  presets: MetricPreset[];
}

function buildCustomMetricDefinition(metricKey: string): MetricSelectorMetricDefinition {
  const label = formatMetricDisplayName(metricKey) || metricKey;

  return {
    key: metricKey,
    label,
    abbreviation: label.length > 12 ? metricKey.toUpperCase() : label,
    direction: isLowerBetter(metricKey) ? 'lower' : 'higher',
    group: 'general',
    isCustom: true,
  };
}

function normalizeMetricKeyList(metricKeys: readonly string[]): string[] {
  const keys = new Set<string>();

  for (const metricKey of metricKeys) {
    const key = canonicalMetricKey(metricKey);
    if (key) keys.add(key);
  }

  return [...keys];
}

function buildRuntimeMetricDefinitions(metricKeys: readonly string[]): MetricSelectorMetricDefinition[] {
  const keys = normalizeMetricKeyList(metricKeys);
  const knownDefinitions = getMetricDefinitions(keys);
  const knownKeys = new Set(knownDefinitions.map((metric) => metric.key));
  const customDefinitions = keys
    .filter((key) => !knownKeys.has(key))
    .map(buildCustomMetricDefinition);

  return [...knownDefinitions, ...customDefinitions];
}

function groupMetricSelectorDefinitions(
  definitions: readonly MetricSelectorMetricDefinition[],
): MetricSelectorSection[] {
  const customMetrics = definitions.filter((metric) => metric.isCustom);
  const knownKeys = definitions
    .filter((metric) => !metric.isCustom)
    .map((metric) => metric.key);

  return [
    ...groupMetricDefinitions(knownKeys),
    ...(customMetrics.length > 0
      ? [{
        group: 'custom' as const,
        label: 'Custom',
        metrics: customMetrics,
      }]
      : []),
  ];
}

export function buildMetricSelectorData({
  taskType,
  taskTypes,
  selectedMetrics,
  availableMetricKeys,
}: {
  taskType: string | null;
  taskTypes?: readonly string[];
  selectedMetrics: readonly string[];
  availableMetricKeys?: readonly string[];
}): MetricSelectorData {
  const available = availableMetricKeys
    ? buildRuntimeMetricDefinitions(availableMetricKeys)
    : getAvailableMetrics(taskType);
  const availableSections = groupMetricSelectorDefinitions(available);
  const availableSet = new Set(available.map((metric) => metric.key));
  const presetSource = taskTypes && taskTypes.length > 0
    ? getPresetsForTaskTypes(taskTypes)
    : getPresetsForTaskType(taskType);
  const presets = presetSource
    .map((preset) => ({
      ...preset,
      keys: preset.keys.filter((key) => availableSet.has(key)),
    }))
    .filter((preset) => preset.keys.length > 0);

  return {
    selectedCount: selectedMetrics.length,
    availableSections,
    presets,
  };
}

export function toggleMetricSelection(
  selectedMetrics: readonly string[],
  metricKey: string,
): string[] {
  return selectedMetrics.includes(metricKey)
    ? selectedMetrics.filter((metric) => metric !== metricKey)
    : [...selectedMetrics, metricKey];
}

export function getMetricDirectionSymbol(direction: MetricDefinition['direction']): string {
  if (direction === 'higher') return '↑';
  if (direction === 'lower') return '↓';
  return '~0';
}
