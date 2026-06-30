import { describe, expect, it } from 'vitest';
import type { ParameterDefinition } from '@/data/nodes/types';
import {
  appendEditorParameter,
  buildCustomNodeFromEditorDraft,
  coerceEditorParameterDefault,
  formatEditorParameterOptions,
  getCustomNodeEditorNodeId,
  getEditorClassPathAllowlistStatus,
  moveEditorParameter,
  parseEditorParameterOptionsInput,
  removeEditorParameter,
  updateEditorParameter,
  type CustomNodeEditorDraft,
} from './CustomNodeEditorLogic';

function createDraft(overrides: Partial<CustomNodeEditorDraft> = {}): CustomNodeEditorDraft {
  return {
    name: 'My Operator',
    type: 'preprocessing',
    classPath: 'nirs4all.operators.MyOperator',
    description: 'Does useful work',
    category: 'Custom',
    tags: '',
    parameters: [],
    isAdvanced: false,
    isDeepLearning: false,
    ...overrides,
  };
}

describe('CustomNodeEditorLogic', () => {
  describe('buildCustomNodeFromEditorDraft', () => {
    it('normalizes editor draft values into a custom node definition', () => {
      const parameters: ParameterDefinition[] = [
        { name: 'alpha', type: 'float', default: 0.1 },
      ];

      const node = buildCustomNodeFromEditorDraft(createDraft({
        name: '  My Operator  ',
        type: 'model',
        classPath: '  nirs4all.operators.MyOperator  ',
        description: '  Does useful work  ',
        category: '  Modeling  ',
        tags: 'model, custom, , experimental',
        parameters,
        isAdvanced: true,
        isDeepLearning: true,
      }));

      expect(node).toEqual({
        id: 'custom.my_operator',
        name: 'My Operator',
        type: 'model',
        classPath: 'nirs4all.operators.MyOperator',
        description: 'Does useful work',
        category: 'Modeling',
        tags: ['model', 'custom', 'experimental'],
        parameters,
        isAdvanced: true,
        isDeepLearning: true,
        source: 'custom',
      });
      expect(node.parameters).toBe(parameters);
    });

    it('preserves the initial id in edit mode and keeps editor fallbacks', () => {
      const node = buildCustomNodeFromEditorDraft(createDraft({
        name: 'Renamed Operator',
        classPath: '   ',
        category: '   ',
      }), {
        isEditMode: true,
        initialNodeId: 'custom.existing_operator',
      });

      expect(node.id).toBe('custom.existing_operator');
      expect(node.classPath).toBeUndefined();
      expect(node.category).toBe('Custom');
      expect(node.tags).toEqual([]);
    });
  });

  describe('id preview and class path allowlist', () => {
    it('uses existing ids in edit mode and generated ids otherwise', () => {
      expect(getCustomNodeEditorNodeId('Renamed Operator', true, 'custom.original')).toBe('custom.original');
      expect(getCustomNodeEditorNodeId('Renamed Operator', false, 'custom.original')).toBe('custom.renamed_operator');
      expect(getCustomNodeEditorNodeId('   ', false)).toBe('custom.unnamed');
    });

    it('matches exact packages and package subpaths', () => {
      const allowedPackages = ['nirs4all', 'sklearn'];

      expect(getEditorClassPathAllowlistStatus('', allowedPackages)).toBeNull();
      expect(getEditorClassPathAllowlistStatus('   ', allowedPackages)).toBeNull();
      expect(getEditorClassPathAllowlistStatus('nirs4all', allowedPackages)).toBe(true);
      expect(getEditorClassPathAllowlistStatus('nirs4all.operators.Custom', allowedPackages)).toBe(true);
      expect(getEditorClassPathAllowlistStatus('nirs4all_extra.operators.Custom', allowedPackages)).toBe(false);
      expect(getEditorClassPathAllowlistStatus(' nirs4all.operators.Custom', allowedPackages)).toBe(false);
    });
  });

  describe('parameter helpers', () => {
    it('appends, removes, updates, and moves parameters immutably', () => {
      const parameters: ParameterDefinition[] = [
        { name: 'alpha', type: 'float', default: 0.1 },
        { name: 'count', type: 'int', default: 2 },
        { name: 'kernel', type: 'select', default: 'linear' },
      ];

      const appended = appendEditorParameter(parameters);
      expect(appended).toHaveLength(4);
      expect(appended[0]).toBe(parameters[0]);
      expect(appended[3]).toMatchObject({ name: 'param', type: 'float', default: 0 });

      const updated = updateEditorParameter(parameters, 1, { name: 'iterations', default: 10 });
      expect(updated).toEqual([
        parameters[0],
        { name: 'iterations', type: 'int', default: 10 },
        parameters[2],
      ]);
      expect(updated).not.toBe(parameters);
      expect(updated[0]).toBe(parameters[0]);
      expect(updated[1]).not.toBe(parameters[1]);

      expect(removeEditorParameter(parameters, 0)).toEqual([parameters[1], parameters[2]]);
      expect(moveEditorParameter(parameters, 2, 0)).toEqual([parameters[2], parameters[0], parameters[1]]);
      expect(parameters.map((parameter) => parameter.name)).toEqual(['alpha', 'count', 'kernel']);
    });

    it('formats and parses select options from the editor input', () => {
      expect(formatEditorParameterOptions([
        { value: 'linear', label: 'Linear' },
        { value: 'rbf', label: 'RBF' },
        'poly',
      ])).toBe('linear, rbf, poly');

      expect(parseEditorParameterOptionsInput(' linear, rbf, , poly ')).toEqual([
        { value: 'linear', label: 'linear' },
        { value: 'rbf', label: 'rbf' },
        { value: 'poly', label: 'poly' },
      ]);
    });

    it('coerces default input values the same way as the editor controls', () => {
      expect(coerceEditorParameterDefault('4.8', 'int')).toBe(4);
      expect(coerceEditorParameterDefault('', 'int')).toBe(0);
      expect(coerceEditorParameterDefault('0.25', 'float')).toBe(0.25);
      expect(coerceEditorParameterDefault('invalid', 'float')).toBe(0);
      expect(coerceEditorParameterDefault('text', 'string')).toBe('text');
      expect(coerceEditorParameterDefault('rbf', 'select')).toBe('rbf');
    });
  });
});
