import { describe, expect, it } from 'vitest';

import {
  HIGHLIGHT_COLORS,
  detectMetadataType,
  getBaseColor,
  getEffectiveTargetType,
  getMetadataUniqueCategories,
  isContinuousMode,
  type BaseColorConfig,
  type BaseColorContext,
} from '../colorConfigBase';
import { getCategoricalColor, getContinuousColor } from '../colorConfigPalettes';
import { PARTITION_COLORS, getHeldOutTestColor } from '../colorConfigPartitions';

const baseConfig: BaseColorConfig = {
  mode: 'target',
  continuousPalette: 'blue_red',
  categoricalPalette: 'default',
  targetTypeOverride: 'auto',
};

describe('colorConfigBase', () => {
  describe('getEffectiveTargetType', () => {
    it('uses the detected target type unless a concrete override is set', () => {
      expect(getEffectiveTargetType('regression', undefined)).toBe('regression');
      expect(getEffectiveTargetType('classification', 'auto')).toBe('classification');
      expect(getEffectiveTargetType('regression', 'classification')).toBe('classification');
      expect(getEffectiveTargetType(undefined, 'ordinal')).toBe('ordinal');
    });
  });

  describe('isContinuousMode', () => {
    it('treats classification and ordinal targets as categorical', () => {
      expect(isContinuousMode('target', undefined, 'classification')).toBe(false);
      expect(isContinuousMode('target', undefined, 'ordinal')).toBe(false);
      expect(isContinuousMode('target', undefined, 'regression')).toBe(true);
    });

    it('applies target type overrides before deciding target continuity', () => {
      expect(isContinuousMode('target', undefined, 'classification', 'regression')).toBe(true);
      expect(isContinuousMode('target', undefined, 'regression', 'classification')).toBe(false);
      expect(isContinuousMode('target', undefined, 'regression', 'ordinal')).toBe(false);
    });

    it('keeps index and continuous metadata modes continuous', () => {
      expect(isContinuousMode('index')).toBe(true);
      expect(isContinuousMode('metadata', 'continuous')).toBe(true);
      expect(isContinuousMode('metadata', 'categorical')).toBe(false);
      expect(isContinuousMode('partition')).toBe(false);
    });
  });

  describe('detectMetadataType', () => {
    it('classifies empty, non-numeric, and low-cardinality numeric metadata as categorical', () => {
      expect(detectMetadataType([])).toBe('categorical');
      expect(detectMetadataType([null, undefined, 1, '2'])).toBe('categorical');
      expect(detectMetadataType([1, 1, 2, 2, 3, 3])).toBe('categorical');
      expect(detectMetadataType([1, 2, Number.NaN])).toBe('categorical');
    });

    it('classifies sufficiently varied finite numeric metadata as continuous', () => {
      const values = Array.from({ length: 11 }, (_, index) => index);

      expect(detectMetadataType(values)).toBe('continuous');
    });
  });

  describe('getMetadataUniqueCategories', () => {
    it('preserves first-seen category order after stringifying non-null values', () => {
      expect(getMetadataUniqueCategories(['batch-b', 2, '2', null, 'batch-b', false, undefined])).toEqual([
        'batch-b',
        '2',
        'false',
      ]);
    });
  });

  describe('getBaseColor', () => {
    it('uses classLabelMap indices for classification targets', () => {
      const config: BaseColorConfig = {
        ...baseConfig,
        mode: 'target',
        categoricalPalette: 'default',
      };
      const context: BaseColorContext = {
        y: [10, 20, 30],
        yMin: 10,
        yMax: 30,
        targetType: 'classification',
        classLabels: ['low', 'medium', 'high'],
        classLabelMap: new Map([
          ['10', 0],
          ['20', 2],
        ]),
      };

      expect(getBaseColor(0, config, context)).toBe(getCategoricalColor(0, 'default'));
      expect(getBaseColor(1, config, context)).toBe(getCategoricalColor(2, 'default'));
      expect(getBaseColor(2, config, context)).toBe(HIGHLIGHT_COLORS.unselected);
    });

    it('colors continuous metadata from finite values and mutes non-finite entries', () => {
      const config: BaseColorConfig = {
        ...baseConfig,
        mode: 'metadata',
        metadataKey: 'sensor_score',
        metadataType: 'continuous',
        continuousPalette: 'blue_red',
      };
      const context: BaseColorContext = {
        metadata: {
          sensor_score: [0, Number.POSITIVE_INFINITY, 10, Number.NaN, null],
        },
      };

      expect(getBaseColor(0, config, context)).toBe(getContinuousColor(0, 'blue_red'));
      expect(getBaseColor(1, config, context)).toBe(HIGHLIGHT_COLORS.unselected);
      expect(getBaseColor(2, config, context)).toBe(getContinuousColor(1, 'blue_red'));
      expect(getBaseColor(3, config, context)).toBe(HIGHLIGHT_COLORS.unselected);
      expect(getBaseColor(4, config, context)).toBe(HIGHLIGHT_COLORS.unselected);
    });

    it('uses partition roles and held-out fold colors from the base context', () => {
      const partitionConfig: BaseColorConfig = {
        ...baseConfig,
        mode: 'partition',
      };
      const splitContext: BaseColorContext = {
        trainIndices: new Set([0]),
        testIndices: new Set([1]),
        foldKind: 'test_split',
        foldCount: 1,
        foldLabels: [-1, -1],
      };

      expect(getBaseColor(0, partitionConfig, splitContext)).toBe(PARTITION_COLORS.train);
      expect(getBaseColor(1, partitionConfig, splitContext)).toBe(PARTITION_COLORS.test);

      const foldConfig: BaseColorConfig = {
        ...baseConfig,
        mode: 'fold',
        categoricalPalette: 'default',
      };
      const foldContext: BaseColorContext = {
        testIndices: new Set([1]),
        foldKind: 'cv_folds',
        foldCount: 2,
        foldLabels: [0, -1],
      };

      expect(getBaseColor(0, foldConfig, foldContext)).toBe(getCategoricalColor(0, 'default'));
      expect(getBaseColor(1, foldConfig, foldContext)).toBe(getHeldOutTestColor());
    });
  });
});
