import type { OperatorDefinition } from '@/types/playground';

export type PlaygroundTabType = 'preprocessing' | 'augmentation' | 'splitting' | 'filter';

export type OperatorPaletteTierLevel = 'core' | 'standard' | 'all';

export type OperatorPaletteNodeType =
  | PlaygroundTabType
  | 'sample_augmentation'
  | 'feature_augmentation'
  | 'sample_filter';

export type OperatorsByTab = Record<PlaygroundTabType, OperatorDefinition[]>;
export type OperatorsByCategory = Record<PlaygroundTabType, Record<string, OperatorDefinition[]>>;

export interface OperatorPaletteNodeParameter {
  name: string;
  required?: boolean;
  default?: unknown;
  type?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: OperatorDefinition['params'][string]['options'];
  description?: string;
  isAdvanced?: boolean;
}

export interface OperatorPaletteNode {
  id?: string;
  classPath?: string;
  name: string;
  description: string;
  category?: string;
  parameters?: OperatorPaletteNodeParameter[];
  isAdvanced?: boolean;
  tier?: 'core' | 'standard' | 'advanced';
  source?: OperatorDefinition['source'];
}

export const PLAYGROUND_OPERATOR_NODE_TYPES: Record<PlaygroundTabType, readonly OperatorPaletteNodeType[]> = {
  preprocessing: ['preprocessing'],
  augmentation: ['augmentation', 'sample_augmentation', 'feature_augmentation'],
  splitting: ['splitting'],
  filter: ['filter', 'sample_filter'],
};

const CATEGORY_LABELS: Record<string, string> = {
  'nirs core': 'NIRS Core',
  scatter_correction: 'Scatter Correction',
  sklearn: 'Scikit-learn',
  'sklearn-splitters': 'Scikit-learn Splitters',
};

export function createEmptyOperatorsByTab(): OperatorsByTab {
  return {
    preprocessing: [],
    augmentation: [],
    splitting: [],
    filter: [],
  };
}

export function passesOperatorTierFilter(
  node: OperatorPaletteNode,
  tierLevel: OperatorPaletteTierLevel
): boolean {
  if (tierLevel === 'all') return true;
  const tier = node.tier ?? (node.isAdvanced ? 'advanced' : 'standard');
  if (tierLevel === 'core') return tier === 'core';
  return tier !== 'advanced';
}

export function nodeToOperatorDefinition(
  node: OperatorPaletteNode,
  tabType: PlaygroundTabType
): OperatorDefinition {
  const params: OperatorDefinition['params'] = {};

  for (const param of node.parameters ?? []) {
    params[param.name] = {
      required: param.required ?? false,
      default: param.default,
      type: param.type,
      default_is_callable: false,
      min: param.min,
      max: param.max,
      step: param.step,
      options: param.options,
      description: param.description,
      isAdvanced: param.isAdvanced,
    };
  }

  const displayName = node.name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

  return {
    registryId: node.id,
    classPath: node.classPath,
    name: node.name,
    display_name: displayName,
    description: node.description,
    category: node.category ?? 'Other',
    params,
    type: tabType,
    source: node.source,
  };
}

export function buildOperatorsByTab({
  getNodesByType,
  tierLevel,
}: {
  getNodesByType?: (type: OperatorPaletteNodeType) => readonly OperatorPaletteNode[];
  tierLevel: OperatorPaletteTierLevel;
}): OperatorsByTab {
  const result = createEmptyOperatorsByTab();

  if (!getNodesByType) {
    return result;
  }

  for (const [tabType, nodeTypes] of Object.entries(PLAYGROUND_OPERATOR_NODE_TYPES) as [
    PlaygroundTabType,
    readonly OperatorPaletteNodeType[],
  ][]) {
    for (const nodeType of nodeTypes) {
      for (const node of getNodesByType(nodeType)) {
        if (passesOperatorTierFilter(node, tierLevel)) {
          result[tabType].push(nodeToOperatorDefinition(node, tabType));
        }
      }
    }
  }

  return result;
}

export function groupOperatorsByCategory(operatorsByTab: OperatorsByTab): OperatorsByCategory {
  const result: OperatorsByCategory = {
    preprocessing: {},
    augmentation: {},
    splitting: {},
    filter: {},
  };

  for (const [tabType, operators] of Object.entries(operatorsByTab) as [
    PlaygroundTabType,
    OperatorDefinition[],
  ][]) {
    for (const operator of operators) {
      const category = operator.category || 'other';
      result[tabType][category] ??= [];
      result[tabType][category].push(operator);
    }
  }

  return result;
}

export function operatorMatchesSearchQuery(operator: OperatorDefinition, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  return (
    operator.name.toLowerCase().includes(normalizedQuery) ||
    operator.display_name.toLowerCase().includes(normalizedQuery) ||
    operator.description.toLowerCase().includes(normalizedQuery)
  );
}

export function filterOperatorsBySearchQuery(
  operatorsByTab: OperatorsByTab,
  query: string
): OperatorsByTab {
  if (!query.trim()) {
    return operatorsByTab;
  }

  return {
    preprocessing: operatorsByTab.preprocessing.filter((operator) => operatorMatchesSearchQuery(operator, query)),
    augmentation: operatorsByTab.augmentation.filter((operator) => operatorMatchesSearchQuery(operator, query)),
    splitting: operatorsByTab.splitting.filter((operator) => operatorMatchesSearchQuery(operator, query)),
    filter: operatorsByTab.filter.filter((operator) => operatorMatchesSearchQuery(operator, query)),
  };
}

export function countOperatorsByTab(operatorsByTab: OperatorsByTab): number {
  return (
    operatorsByTab.preprocessing.length +
    operatorsByTab.augmentation.length +
    operatorsByTab.splitting.length +
    operatorsByTab.filter.length
  );
}

function humanizeCategoryLabel(category: string): string {
  return category
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase())
    .replace(/\bNirs\b/g, 'NIRS')
    .replace(/\bSklearn\b/g, 'Scikit-learn');
}

export function getOperatorCategoryLabel(category: string): string {
  const trimmedCategory = category.trim();
  if (trimmedCategory.length === 0) {
    return 'Other';
  }

  const lookupKey = trimmedCategory.toLowerCase();
  if (CATEGORY_LABELS[lookupKey]) {
    return CATEGORY_LABELS[lookupKey];
  }

  if (/[A-Z]/.test(trimmedCategory) || trimmedCategory.includes(' ')) {
    return trimmedCategory;
  }

  return humanizeCategoryLabel(trimmedCategory);
}

export function getOperatorKey(operator: OperatorDefinition): string {
  return operator.registryId
    ?? operator.classPath
    ?? `${operator.type}:${operator.source ?? 'unknown'}:${operator.name}`;
}
