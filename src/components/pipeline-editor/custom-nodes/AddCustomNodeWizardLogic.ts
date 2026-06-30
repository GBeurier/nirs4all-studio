import type { NodeDefinition, NodeType, ParameterDefinition } from '@/data/nodes/types';
import type { CustomNodeValidationResult } from '@/data/nodes/custom';
import {
  createParameterTemplate,
  generateCustomNodeId,
} from '@/data/nodes/custom';

export const WIZARD_STEP_IDS = [
  'type',
  'info',
  'classpath',
  'parameters',
  'review',
] as const;

export type WizardStep = typeof WIZARD_STEP_IDS[number];

export interface CustomNodeWizardDraft {
  nodeType: NodeType;
  name: string;
  description: string;
  category: string;
  classPath: string;
  parameters: ParameterDefinition[];
}

export function createInitialCustomNodeWizardDraft(): CustomNodeWizardDraft {
  return {
    nodeType: 'preprocessing',
    name: '',
    description: '',
    category: 'Custom',
    classPath: '',
    parameters: [],
  };
}

export function buildCustomNodeFromWizardDraft(draft: CustomNodeWizardDraft): NodeDefinition {
  return {
    id: generateCustomNodeId(draft.name),
    name: draft.name.trim(),
    type: draft.nodeType,
    classPath: draft.classPath.trim() || undefined,
    description: draft.description.trim(),
    category: draft.category.trim() || 'Custom',
    parameters: draft.parameters,
    source: 'custom',
  };
}

export function getWizardStepIndex(step: WizardStep): number {
  return WIZARD_STEP_IDS.findIndex((stepId) => stepId === step);
}

export function getNextWizardStep(step: WizardStep): WizardStep | null {
  const stepIndex = getWizardStepIndex(step);
  return stepIndex >= 0 && stepIndex < WIZARD_STEP_IDS.length - 1
    ? WIZARD_STEP_IDS[stepIndex + 1]
    : null;
}

export function getPreviousWizardStep(step: WizardStep): WizardStep | null {
  const stepIndex = getWizardStepIndex(step);
  return stepIndex > 0 ? WIZARD_STEP_IDS[stepIndex - 1] : null;
}

export function canAdvanceFromWizardStep(
  step: WizardStep,
  draft: Pick<CustomNodeWizardDraft, 'name' | 'description'>,
  validationResult?: CustomNodeValidationResult | null
): boolean {
  switch (step) {
    case 'type':
    case 'classpath':
    case 'parameters':
      return true;
    case 'info':
      return draft.name.trim().length > 0 && draft.description.trim().length > 0;
    case 'review':
      return !validationResult || validationResult.valid;
    default:
      return true;
  }
}

export function getClassPathAllowlistStatus(
  classPath: string,
  allowedPackages: string[]
): boolean | null {
  if (!classPath.trim()) return null;
  return allowedPackages.some((pkg) =>
    classPath.startsWith(pkg + '.') || classPath === pkg
  );
}

export function appendWizardParameter(parameters: ParameterDefinition[]): ParameterDefinition[] {
  return [...parameters, createParameterTemplate()];
}

export function removeWizardParameter(
  parameters: ParameterDefinition[],
  index: number
): ParameterDefinition[] {
  return parameters.filter((_, parameterIndex) => parameterIndex !== index);
}

export function updateWizardParameter(
  parameters: ParameterDefinition[],
  index: number,
  updates: Partial<ParameterDefinition>
): ParameterDefinition[] {
  return parameters.map((parameter, parameterIndex) =>
    parameterIndex === index ? { ...parameter, ...updates } : parameter
  );
}

export function coerceWizardParameterDefault(
  value: string,
  type: ParameterDefinition['type']
): unknown {
  if (type === 'int') return parseInt(value) || 0;
  if (type === 'float') return parseFloat(value) || 0;
  if (type === 'bool') return value === 'true';
  return value;
}
