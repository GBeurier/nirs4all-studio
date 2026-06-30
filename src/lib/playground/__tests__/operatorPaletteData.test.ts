import { describe, expect, it } from 'vitest';
import {
  buildOperatorsByTab,
  countOperatorsByTab,
  filterOperatorsBySearchQuery,
  getOperatorCategoryLabel,
  getOperatorKey,
  groupOperatorsByCategory,
  nodeToOperatorDefinition,
  passesOperatorTierFilter,
  type OperatorPaletteNode,
  type OperatorPaletteNodeType,
} from '../operatorPaletteData';
import type { OperatorDefinition } from '@/types/playground';

function makeNode(overrides: Partial<OperatorPaletteNode> = {}): OperatorPaletteNode {
  return {
    id: overrides.id ?? `node-${overrides.name ?? 'SNV'}`,
    name: overrides.name ?? 'StandardNormalVariate',
    description: overrides.description ?? 'Normalize each spectrum',
    category: overrides.category ?? 'nirs core',
    parameters: overrides.parameters ?? [],
    ...overrides,
  };
}

function makeOperator(overrides: Partial<OperatorDefinition> = {}): OperatorDefinition {
  return {
    name: overrides.name ?? 'SNV',
    display_name: overrides.display_name ?? 'SNV',
    description: overrides.description ?? 'Normalize spectra',
    category: overrides.category ?? 'nirs core',
    params: overrides.params ?? {},
    type: overrides.type ?? 'preprocessing',
    ...overrides,
  };
}

describe('operatorPaletteData', () => {
  it('filters nodes by visibility tier while preserving legacy advanced flags', () => {
    expect(passesOperatorTierFilter(makeNode({ tier: 'core' }), 'core')).toBe(true);
    expect(passesOperatorTierFilter(makeNode({ tier: 'standard' }), 'core')).toBe(false);
    expect(passesOperatorTierFilter(makeNode({ isAdvanced: true }), 'standard')).toBe(false);
    expect(passesOperatorTierFilter(makeNode({ isAdvanced: true }), 'all')).toBe(true);
  });

  it('maps registry nodes to playground operators with parameter metadata', () => {
    const operator = nodeToOperatorDefinition(
      makeNode({
        id: 'preprocessing.snv',
        classPath: 'nirs4all.preprocessing.SNV',
        name: 'SavitzkyGolay',
        source: 'nirs4all',
        parameters: [
          {
            name: 'window_length',
            type: 'number',
            required: true,
            default: 11,
            min: 3,
            max: 51,
            step: 2,
            description: 'Window length',
            isAdvanced: true,
          },
        ],
      }),
      'preprocessing'
    );

    expect(operator).toMatchObject({
      registryId: 'preprocessing.snv',
      classPath: 'nirs4all.preprocessing.SNV',
      name: 'SavitzkyGolay',
      display_name: 'Savitzky Golay',
      category: 'nirs core',
      source: 'nirs4all',
      type: 'preprocessing',
    });
    expect(operator.params.window_length).toEqual({
      required: true,
      default: 11,
      type: 'number',
      default_is_callable: false,
      min: 3,
      max: 51,
      step: 2,
      options: undefined,
      description: 'Window length',
      isAdvanced: true,
    });
  });

  it('builds tab groups from registry node types and excludes advanced operators in standard mode', () => {
    const nodesByType: Partial<Record<OperatorPaletteNodeType, OperatorPaletteNode[]>> = {
      preprocessing: [
        makeNode({ name: 'SNV', tier: 'core' }),
        makeNode({ name: 'ExpertBaseline', tier: 'advanced' }),
      ],
      sample_augmentation: [makeNode({ name: 'NoiseAugmentation', category: 'noise' })],
      feature_augmentation: [makeNode({ name: 'FeatureMixing', category: 'mixing' })],
      sample_filter: [makeNode({ name: 'OutlierFilter', category: 'outlier' })],
      splitting: [makeNode({ name: 'KFold', category: 'sklearn-splitters' })],
    };

    const operatorsByTab = buildOperatorsByTab({
      tierLevel: 'standard',
      getNodesByType: (type) => nodesByType[type] ?? [],
    });

    expect(operatorsByTab.preprocessing.map((operator) => operator.name)).toEqual(['SNV']);
    expect(operatorsByTab.augmentation.map((operator) => operator.name)).toEqual([
      'NoiseAugmentation',
      'FeatureMixing',
    ]);
    expect(operatorsByTab.filter.map((operator) => operator.name)).toEqual(['OutlierFilter']);
    expect(operatorsByTab.splitting.map((operator) => operator.name)).toEqual(['KFold']);
    expect(countOperatorsByTab(operatorsByTab)).toBe(5);
  });

  it('groups and filters operators without coupling to component state', () => {
    const operatorsByTab = {
      preprocessing: [
        makeOperator({ name: 'SNV', display_name: 'SNV', category: 'nirs core' }),
        makeOperator({ name: 'SavitzkyGolay', display_name: 'Savitzky Golay', category: 'smoothing' }),
      ],
      augmentation: [makeOperator({ name: 'Noise', description: 'Add gaussian noise', type: 'augmentation' })],
      splitting: [],
      filter: [],
    };

    expect(Object.keys(groupOperatorsByCategory(operatorsByTab).preprocessing)).toEqual([
      'nirs core',
      'smoothing',
    ]);
    expect(filterOperatorsBySearchQuery(operatorsByTab, 'gaussian').augmentation).toHaveLength(1);
    expect(filterOperatorsBySearchQuery(operatorsByTab, 'golay').preprocessing.map((operator) => operator.name)).toEqual([
      'SavitzkyGolay',
    ]);
  });

  it('normalizes category labels and operator keys for stable rendering', () => {
    expect(getOperatorCategoryLabel('')).toBe('Other');
    expect(getOperatorCategoryLabel('nirs core')).toBe('NIRS Core');
    expect(getOperatorCategoryLabel('feature-selection')).toBe('Feature Selection');

    expect(getOperatorKey(makeOperator({ registryId: 'node-id' }))).toBe('node-id');
    expect(getOperatorKey(makeOperator({ registryId: undefined, classPath: 'pkg.Node' }))).toBe('pkg.Node');
    expect(getOperatorKey(makeOperator({ registryId: undefined, classPath: undefined, source: 'sklearn' }))).toBe(
      'preprocessing:sklearn:SNV'
    );
  });
});
