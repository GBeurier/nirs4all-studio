import { describe, expect, it } from 'vitest';
import type { ParameterDefinition } from '@/data/nodes/types';
import type { CustomNodeValidationResult } from '@/data/nodes/custom';
import {
  appendWizardParameter,
  buildCustomNodeFromWizardDraft,
  canAdvanceFromWizardStep,
  coerceWizardParameterDefault,
  createInitialCustomNodeWizardDraft,
  getClassPathAllowlistStatus,
  getNextWizardStep,
  getPreviousWizardStep,
  getWizardStepIndex,
  removeWizardParameter,
  updateWizardParameter,
  type CustomNodeWizardDraft,
} from './AddCustomNodeWizardLogic';

function createDraft(overrides: Partial<CustomNodeWizardDraft> = {}): CustomNodeWizardDraft {
  return {
    ...createInitialCustomNodeWizardDraft(),
    name: 'My Operator',
    description: 'Does useful work',
    ...overrides,
  };
}

describe('AddCustomNodeWizardLogic', () => {
  describe('buildCustomNodeFromWizardDraft', () => {
    it('normalizes wizard draft values into a custom node definition', () => {
      const parameters: ParameterDefinition[] = [
        { name: 'alpha', type: 'float', default: 0.1 },
      ];

      const node = buildCustomNodeFromWizardDraft(createDraft({
        nodeType: 'model',
        name: '  My Operator  ',
        description: '  Does useful work  ',
        category: '  Modeling  ',
        classPath: '  nirs4all.operators.MyOperator  ',
        parameters,
      }));

      expect(node).toEqual({
        id: 'custom.my_operator',
        name: 'My Operator',
        type: 'model',
        classPath: 'nirs4all.operators.MyOperator',
        description: 'Does useful work',
        category: 'Modeling',
        parameters,
        source: 'custom',
      });
      expect(node.parameters).toBe(parameters);
    });

    it('falls back to Custom category and omits blank class paths', () => {
      const node = buildCustomNodeFromWizardDraft(createDraft({
        category: '   ',
        classPath: '   ',
      }));

      expect(node.category).toBe('Custom');
      expect(node.classPath).toBeUndefined();
    });
  });

  describe('navigation', () => {
    it('resolves step positions and boundaries', () => {
      expect(getWizardStepIndex('type')).toBe(0);
      expect(getNextWizardStep('type')).toBe('info');
      expect(getPreviousWizardStep('type')).toBeNull();
      expect(getNextWizardStep('review')).toBeNull();
      expect(getPreviousWizardStep('review')).toBe('parameters');
    });

    it('keeps info and review gating in pure logic', () => {
      const validResult: CustomNodeValidationResult = { valid: true, errors: [], warnings: [] };
      const invalidResult: CustomNodeValidationResult = { valid: false, errors: ['bad'], warnings: [] };

      expect(canAdvanceFromWizardStep('type', createDraft())).toBe(true);
      expect(canAdvanceFromWizardStep('info', createDraft({ name: ' ', description: 'ready' }))).toBe(false);
      expect(canAdvanceFromWizardStep('info', createDraft({ name: 'ready', description: ' ' }))).toBe(false);
      expect(canAdvanceFromWizardStep('info', createDraft({ name: 'ready', description: 'ready' }))).toBe(true);
      expect(canAdvanceFromWizardStep('review', createDraft(), null)).toBe(true);
      expect(canAdvanceFromWizardStep('review', createDraft(), validResult)).toBe(true);
      expect(canAdvanceFromWizardStep('review', createDraft(), invalidResult)).toBe(false);
    });
  });

  describe('class path allowlist status', () => {
    it('matches exact packages and package subpaths', () => {
      const allowedPackages = ['nirs4all', 'sklearn'];

      expect(getClassPathAllowlistStatus('', allowedPackages)).toBeNull();
      expect(getClassPathAllowlistStatus('   ', allowedPackages)).toBeNull();
      expect(getClassPathAllowlistStatus('nirs4all', allowedPackages)).toBe(true);
      expect(getClassPathAllowlistStatus('nirs4all.operators.Custom', allowedPackages)).toBe(true);
      expect(getClassPathAllowlistStatus('nirs4all_extra.operators.Custom', allowedPackages)).toBe(false);
      expect(getClassPathAllowlistStatus(' nirs4all.operators.Custom', allowedPackages)).toBe(false);
    });
  });

  describe('parameter updates', () => {
    it('appends, removes, and updates parameters immutably', () => {
      const parameters: ParameterDefinition[] = [
        { name: 'alpha', type: 'float', default: 0.1 },
        { name: 'count', type: 'int', default: 2 },
      ];

      const appended = appendWizardParameter(parameters);
      expect(appended).toHaveLength(3);
      expect(appended[0]).toBe(parameters[0]);
      expect(appended[2]).toMatchObject({ name: 'param', type: 'float', default: 0 });

      const removed = removeWizardParameter(parameters, 0);
      expect(removed).toEqual([parameters[1]]);

      const updated = updateWizardParameter(parameters, 1, { name: 'iterations', default: 10 });
      expect(updated).toEqual([
        parameters[0],
        { name: 'iterations', type: 'int', default: 10 },
      ]);
      expect(updated).not.toBe(parameters);
      expect(updated[0]).toBe(parameters[0]);
      expect(updated[1]).not.toBe(parameters[1]);
    });

    it('coerces default input values the same way as the wizard controls', () => {
      expect(coerceWizardParameterDefault('4.8', 'int')).toBe(4);
      expect(coerceWizardParameterDefault('', 'int')).toBe(0);
      expect(coerceWizardParameterDefault('0.25', 'float')).toBe(0.25);
      expect(coerceWizardParameterDefault('invalid', 'float')).toBe(0);
      expect(coerceWizardParameterDefault('true', 'bool')).toBe(true);
      expect(coerceWizardParameterDefault('false', 'bool')).toBe(false);
      expect(coerceWizardParameterDefault('rbf', 'select')).toBe('rbf');
      expect(coerceWizardParameterDefault('text', 'string')).toBe('text');
    });
  });
});
