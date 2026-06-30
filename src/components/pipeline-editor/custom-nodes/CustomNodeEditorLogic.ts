import type { NodeDefinition, NodeType, ParameterDefinition, SelectOption } from '@/data/nodes/types';
import {
  createParameterTemplate,
  generateCustomNodeId,
} from '@/data/nodes/custom';

export interface CustomNodeEditorDraft {
  name: string;
  type: NodeType;
  classPath: string;
  description: string;
  category: string;
  tags: string;
  parameters: ParameterDefinition[];
  isAdvanced: boolean;
  isDeepLearning: boolean;
}

type EditableParameterOption = SelectOption | string | number | boolean;

export function getCustomNodeEditorNodeId(
  name: string,
  isEditMode: boolean,
  initialNodeId?: string
): string {
  return isEditMode && initialNodeId ? initialNodeId : generateCustomNodeId(name);
}

export function parseCustomNodeEditorTags(tags: string): string[] {
  return tags.split(',').map((tag) => tag.trim()).filter(Boolean);
}

export function buildCustomNodeFromEditorDraft(
  draft: CustomNodeEditorDraft,
  options: {
    isEditMode?: boolean;
    initialNodeId?: string;
  } = {}
): NodeDefinition {
  return {
    id: getCustomNodeEditorNodeId(draft.name, options.isEditMode ?? false, options.initialNodeId),
    name: draft.name.trim(),
    type: draft.type,
    classPath: draft.classPath.trim() || undefined,
    description: draft.description.trim(),
    category: draft.category.trim() || 'Custom',
    tags: parseCustomNodeEditorTags(draft.tags),
    parameters: draft.parameters,
    isAdvanced: draft.isAdvanced,
    isDeepLearning: draft.isDeepLearning,
    source: 'custom',
  };
}

export function getEditorClassPathAllowlistStatus(
  classPath: string,
  allowedPackages: string[]
): boolean | null {
  if (!classPath.trim()) return null;
  return allowedPackages.some((pkg) =>
    classPath.startsWith(pkg + '.') || classPath === pkg
  );
}

export function appendEditorParameter(parameters: ParameterDefinition[]): ParameterDefinition[] {
  return [...parameters, createParameterTemplate()];
}

export function updateEditorParameter(
  parameters: ParameterDefinition[],
  index: number,
  updates: Partial<ParameterDefinition>
): ParameterDefinition[] {
  return parameters.map((parameter, parameterIndex) =>
    parameterIndex === index ? { ...parameter, ...updates } : parameter
  );
}

export function removeEditorParameter(
  parameters: ParameterDefinition[],
  index: number
): ParameterDefinition[] {
  return parameters.filter((_, parameterIndex) => parameterIndex !== index);
}

export function moveEditorParameter(
  parameters: ParameterDefinition[],
  fromIndex: number,
  toIndex: number
): ParameterDefinition[] {
  const newParams = [...parameters];
  const [moved] = newParams.splice(fromIndex, 1);
  newParams.splice(toIndex, 0, moved);
  return newParams;
}

export function formatEditorParameterOptions(
  options?: readonly EditableParameterOption[]
): string {
  if (!options) return '';
  return options.map((option) =>
    typeof option === 'object' ? option.value : option
  ).join(', ');
}

export function parseEditorParameterOptionsInput(value: string): SelectOption[] {
  return value
    .split(',')
    .map((option) => option.trim())
    .filter(Boolean)
    .map((option) => ({
      value: option,
      label: option,
    }));
}

export function coerceEditorParameterDefault(
  value: string,
  type: ParameterDefinition['type']
): unknown {
  if (type === 'int') return parseInt(value) || 0;
  if (type === 'float') return parseFloat(value) || 0;
  return value;
}
