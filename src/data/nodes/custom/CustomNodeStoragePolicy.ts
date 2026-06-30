import type { CustomNodeDefinition, CustomNodeParameter, CustomNodeSettings } from '@/api/customNodes';
import type { CustomNodesFile, NodeDefinition, NodeType, ParameterDefinition, ParameterType } from '../types';
import type { CustomNodeSecurityConfig, CustomNodeValidationResult } from './CustomNodeStorage';

export const CUSTOM_NODE_STORAGE_VERSION = '1.0.0';

const VALID_PARAMETER_TYPES = ['int', 'float', 'bool', 'string', 'select', 'range', 'array', 'object'];

export type CustomNodePayload = Omit<CustomNodeDefinition, 'created_at' | 'updated_at' | 'source'>;

export interface WorkspaceTrackedNodeDefinition extends NodeDefinition {
  _storageSource: 'workspace';
  _lastSynced: string;
}

export interface MigrationDecision {
  file: CustomNodesFile;
  migrated: boolean;
  fromVersion: string | null;
  toVersion: string;
}

export function createDefaultSecurityConfig(defaultAllowedPackages: string[]): CustomNodeSecurityConfig {
  return {
    allowCustomNodes: true,
    allowedPackages: [...defaultAllowedPackages],
    requireApproval: false,
    allowUserPackages: true,
  };
}

export function resolveAllowedPackages(config: CustomNodeSecurityConfig, userPackages: string[]): string[] {
  const configuredUserPackages = config.allowUserPackages ? userPackages : [];
  return [...new Set([...config.allowedPackages, ...configuredUserPackages])];
}

export function validateCustomNode(
  node: NodeDefinition,
  config: CustomNodeSecurityConfig,
  allowedPackages: string[]
): CustomNodeValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.allowCustomNodes) {
    errors.push('Custom nodes are disabled');
    return { valid: false, errors, warnings };
  }

  const idValidation = validateCustomNodeId(node.id);
  if (!idValidation.valid) {
    errors.push(...idValidation.errors);
  }

  if (node.classPath) {
    const classPathValidation = validateCustomClassPath(node.classPath, allowedPackages);
    if (!classPathValidation.valid) {
      errors.push(...classPathValidation.errors);
    }
  }

  if (!node.name || node.name.trim().length === 0) {
    errors.push('Name is required');
  }

  if (!node.type) {
    errors.push('Type is required');
  }

  if (!node.description || node.description.trim().length === 0) {
    errors.push('Description is required');
  }

  if (!Array.isArray(node.parameters)) {
    errors.push('Parameters must be an array');
  } else {
    for (let i = 0; i < node.parameters.length; i++) {
      errors.push(...validateCustomParameter(node.parameters[i], i));
    }
  }

  if (!node.category) {
    warnings.push('Consider adding a category for better organization');
  }

  if (!node.classPath) {
    warnings.push('No classPath specified - node will not be executable');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function validateCustomNodeId(id: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!id || typeof id !== 'string') {
    errors.push('Node ID is required');
    return { valid: false, errors };
  }

  const idPattern = /^(custom|user|workspace|admin)\.[a-z][a-z0-9_]*$/;
  if (!idPattern.test(id)) {
    errors.push(
      `Invalid ID format: "${id}". Must be namespace.snake_case (e.g., custom.my_operator). ` +
      `Allowed namespaces: custom, user, workspace, admin`
    );
  }

  return { valid: errors.length === 0, errors };
}

export function validateCustomClassPath(classPath: string, allowedPackages: string[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!classPath || typeof classPath !== 'string') {
    return { valid: true, errors };
  }

  const packageRoot = classPath.split('.')[0];
  const isAllowed = allowedPackages.some(pkg =>
    classPath.startsWith(pkg + '.') || classPath === pkg
  );

  if (!isAllowed) {
    errors.push(
      `Package "${packageRoot}" is not in the allowlist. ` +
      `Allowed packages: ${allowedPackages.join(', ')}`
    );
  }

  return { valid: errors.length === 0, errors };
}

export function validateCustomParameter(param: ParameterDefinition, index: number): string[] {
  const errors: string[] = [];
  const prefix = `Parameter[${index}]`;

  if (!param.name || param.name.trim().length === 0) {
    errors.push(`${prefix}: name is required`);
  } else if (!/^[a-z][a-z0-9_]*$/.test(param.name)) {
    errors.push(`${prefix}: name must be snake_case (e.g., my_param)`);
  }

  if (!param.type) {
    errors.push(`${prefix}: type is required`);
  } else if (!VALID_PARAMETER_TYPES.includes(param.type)) {
    errors.push(`${prefix}: invalid type "${param.type}". Valid: ${VALID_PARAMETER_TYPES.join(', ')}`);
  }

  if (param.type === 'select' && (!param.options || param.options.length === 0)) {
    errors.push(`${prefix}: select type requires options`);
  }

  if (param.type === 'int' || param.type === 'float') {
    if (param.min !== undefined && param.max !== undefined && param.min > param.max) {
      errors.push(`${prefix}: min cannot be greater than max`);
    }
  }

  return errors;
}

export function createCustomNodesFile(nodes: NodeDefinition[], version: string = CUSTOM_NODE_STORAGE_VERSION): CustomNodesFile {
  return {
    version,
    nodes,
  };
}

export function isCustomNodesFile(data: unknown): data is CustomNodesFile {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const candidate = data as Partial<CustomNodesFile>;
  return Boolean(candidate.version) && Array.isArray(candidate.nodes);
}

export function decideCustomNodesMigration(
  file: CustomNodesFile,
  storedVersion: string | null,
  currentVersion: string = CUSTOM_NODE_STORAGE_VERSION
): MigrationDecision {
  return {
    file,
    migrated: storedVersion !== currentVersion,
    fromVersion: storedVersion,
    toVersion: currentVersion,
  };
}

export function convertApiParameterToNodeParameter(param: CustomNodeParameter): ParameterDefinition {
  return {
    name: param.name,
    type: param.type as ParameterType,
    default: param.default,
    required: param.required,
    description: param.description,
    min: param.min,
    max: param.max,
    step: param.step,
    options: param.options?.map(opt => ({ value: opt, label: opt })),
  };
}

export function convertNodeParameterToApiParameter(param: ParameterDefinition): CustomNodeParameter {
  return {
    name: param.name,
    type: param.type as CustomNodeParameter['type'],
    default: param.default,
    required: param.required,
    description: param.description,
    min: param.min,
    max: param.max,
    step: param.step,
    options: param.options?.map(opt => String(opt.value)),
  };
}

export function convertApiNodeToWorkspaceNode(
  node: CustomNodeDefinition,
  syncedAt: string
): WorkspaceTrackedNodeDefinition {
  return {
    id: node.id,
    name: node.label,
    type: node.stepType as NodeType,
    description: node.description || '',
    parameters: (node.parameters || []).map(convertApiParameterToNodeParameter),
    source: 'custom',
    category: node.category,
    classPath: node.classPath,
    icon: node.icon,
    _storageSource: 'workspace',
    _lastSynced: syncedAt,
  };
}

export function convertWorkspaceSettingsToSecurityConfig(
  settings: CustomNodeSettings,
  defaultAllowedPackages: string[]
): CustomNodeSecurityConfig {
  return {
    allowCustomNodes: settings.enabled,
    allowedPackages: settings.allowedPackages || defaultAllowedPackages,
    requireApproval: settings.requireApproval,
    allowUserPackages: settings.allowUserNodes,
  };
}

export function convertNodeToWorkspacePayload(node: NodeDefinition): CustomNodePayload {
  return {
    id: node.id,
    label: node.name,
    category: node.category || 'Custom',
    description: node.description,
    classPath: node.classPath || '',
    stepType: node.type,
    parameters: (node.parameters || []).map(convertNodeParameterToApiParameter),
    icon: undefined,
    color: undefined,
  };
}
