/**
 * Operator format conversion utilities
 *
 * Provides conversion to/from Pipeline Editor format and utility functions.
 */

import type {
  UnifiedOperator,
  PlaygroundStep,
  OperatorDefinition,
} from '@/types/playground';
import {
  clientStorageKeys,
  isClientStorageAvailable,
  readClientStorageJson,
  removeClientStorageItem,
  writeClientStorageJson,
} from '@/lib/clientStorage';

const PLAYGROUND_RUNTIME_ONLY_SPLITTER_PARAMS = new Set([
  'group_by',
  'group',
  'ignore_repetition',
  'aggregation',
  'y_aggregation',
]);

function stripRuntimeOnlyExportParams(operator: UnifiedOperator): Record<string, unknown> {
  if (operator.type !== 'splitting') {
    return { ...operator.params };
  }

  return Object.fromEntries(
    Object.entries(operator.params).filter(([key]) => !PLAYGROUND_RUNTIME_ONLY_SPLITTER_PARAMS.has(key))
  );
}

// ============= Unified to API Conversion =============

/**
 * Convert UnifiedOperator to PlaygroundStep for API calls
 */
export function unifiedToPlaygroundStep(operator: UnifiedOperator): PlaygroundStep {
  if (operator.name !== 'SampleIndexFilter' && !operator.classPath) {
    throw new Error(`Playground operator "${operator.name}" has no canonical class path`);
  }
  return {
    id: operator.id,
    type: operator.type,
    name: operator.name,
    params: operator.params,
    enabled: operator.enabled,
    ...(operator.classPath
      ? { operator: { class: operator.classPath, params: operator.params } }
      : {}),
  };
}

/**
 * Convert array of UnifiedOperators to PlaygroundSteps
 */
export function unifiedToPlaygroundSteps(operators: UnifiedOperator[]): PlaygroundStep[] {
  return operators.map(unifiedToPlaygroundStep);
}

// ============= Pipeline Editor Format Conversion =============

/**
 * Pipeline Editor step format (simplified view)
 */
export interface PipelineEditorStep {
  id: string;
  type: 'preprocessing' | 'splitting' | 'model' | 'branch' | 'generator' | 'filter' | 'augmentation';
  name: string;
  classPath?: string;
  params: Record<string, unknown>;
  branches?: PipelineEditorStep[][];
  paramSweeps?: Record<string, unknown>;
}

/**
 * Convert UnifiedOperator to Pipeline Editor format
 */
export function unifiedToEditorStep(operator: UnifiedOperator): PipelineEditorStep {
  // Map UnifiedOperatorType to PipelineEditorStep type
  const validTypes = ['preprocessing', 'splitting', 'model', 'branch', 'generator', 'filter', 'augmentation'] as const;
  const type = validTypes.includes(operator.type as typeof validTypes[number])
    ? operator.type as PipelineEditorStep['type']
    : 'preprocessing';

  return {
    id: operator.id,
    type,
    name: operator.name,
    ...(operator.classPath ? { classPath: operator.classPath } : {}),
    params: stripRuntimeOnlyExportParams(operator),
  };
}

/**
 * Convert Pipeline Editor step to UnifiedOperator
 * Filters out unsupported features (branches, models, generators)
 */
export function editorStepToUnified(
  step: PipelineEditorStep
): UnifiedOperator | null {
  // Filter out unsupported step types
  if (step.type === 'model' || step.type === 'branch' || step.type === 'generator') {
    return null;
  }

  // Accept all playground-compatible types
  const playgroundTypes = ['preprocessing', 'splitting', 'augmentation', 'filter'] as const;
  if (!playgroundTypes.includes(step.type as typeof playgroundTypes[number])) {
    return null;
  }

  return {
    id: step.id,
    type: step.type as UnifiedOperator['type'],
    name: step.name,
    classPath: step.classPath,
    params: step.params,
    enabled: true,
  };
}

/**
 * Import a Pipeline Editor pipeline into playground format
 * Returns the converted operators and any warnings about unsupported features
 */
export function importFromPipelineEditor(
  steps: PipelineEditorStep[]
): { operators: UnifiedOperator[]; warnings: string[] } {
  const operators: UnifiedOperator[] = [];
  const warnings: string[] = [];

  for (const step of steps) {
    if (step.type === 'model') {
      warnings.push(`Model step "${step.name}" ignored - models cannot be visualized in Playground`);
      continue;
    }

    if (step.type === 'branch') {
      // Take first branch only
      if (step.branches && step.branches.length > 0) {
        warnings.push('Branch detected - using first branch only');
        const firstBranch = step.branches[0];
        const { operators: branchOps, warnings: branchWarnings } = importFromPipelineEditor(firstBranch);
        operators.push(...branchOps);
        warnings.push(...branchWarnings);
      }
      continue;
    }

    if (step.type === 'generator' || step.paramSweeps) {
      warnings.push(`Generator/sweep in "${step.name}" ignored - using first variant only`);
    }

    const unified = editorStepToUnified(step);
    if (unified) {
      operators.push(unified);
    }
  }

  return { operators, warnings };
}

/**
 * Export playground operators to Pipeline Editor format
 */
export function exportToPipelineEditor(operators: UnifiedOperator[]): PipelineEditorStep[] {
  return operators
    .filter(op => op.enabled)
    .map(unifiedToEditorStep);
}

// ============= Navigation Export =============

/** Key used in client storage for pipeline export */
export const PLAYGROUND_EXPORT_KEY = clientStorageKeys.playgroundPipelineExport.key;

/**
 * Data stored in client storage when exporting to Pipeline Editor
 */
export interface PlaygroundExportData {
  name: string;
  description?: string;
  steps: PipelineEditorStep[];
  timestamp: number;
  source: 'playground';
}

/**
 * Prepare export data and store in client storage.
 * Returns the export data for confirmation or the path to navigate to.
 * Throws an error if client storage is unavailable or full.
 */
export function prepareExportToPipelineEditor(
  operators: UnifiedOperator[],
  pipelineName?: string
): PlaygroundExportData {
  const steps = exportToPipelineEditor(operators);

  const exportData: PlaygroundExportData = {
    name: pipelineName || `Playground Export ${new Date().toLocaleDateString()}`,
    description: 'Exported from Playground',
    steps,
    timestamp: Date.now(),
    source: 'playground',
  };

  // Store in client storage for the Pipeline Editor to pick up.
  try {
    if (!isClientStorageAvailable(clientStorageKeys.playgroundPipelineExport.area)) {
      throw new Error('Unable to export pipeline. Session storage may be unavailable.');
    }

    writeClientStorageJson(clientStorageKeys.playgroundPipelineExport, exportData, {
      onError: (error) => {
        throw error;
      },
    });
  } catch (e) {
    // Client storage might be full or unavailable (private browsing mode in some browsers).
    console.error('Failed to store export data in client storage:', e);
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      throw new Error('Session storage is full. Please clear some data and try again.');
    }
    throw new Error('Unable to export pipeline. Session storage may be unavailable.');
  }

  return exportData;
}

/**
 * Check if there's pending export data from Playground
 */
export function getPlaygroundExportData(): PlaygroundExportData | null {
  return readClientStorageJson<PlaygroundExportData>(clientStorageKeys.playgroundPipelineExport, {
    onError: (e) => {
      console.warn('Failed to parse playground export data:', e);
    },
  });
}

/**
 * Clear the playground export data after it's been consumed
 */
export function clearPlaygroundExportData(): void {
  removeClientStorageItem(clientStorageKeys.playgroundPipelineExport);
}

// ============= Operator Creation =============

/**
 * Create a new UnifiedOperator from an OperatorDefinition
 */
export function createOperatorFromDefinition(
  definition: OperatorDefinition
): UnifiedOperator {
  // Build default params from definition
  const defaultParams: Record<string, unknown> = {};

  for (const [paramName, paramInfo] of Object.entries(definition.params)) {
    if (paramInfo.default !== undefined && !paramInfo.default_is_callable) {
      defaultParams[paramName] = paramInfo.default;
    }
  }

  return {
    id: `${definition.name}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    type: definition.type,
    name: definition.name,
    classPath: definition.classPath,
    params: defaultParams,
    enabled: true,
  };
}

// ============= Type Guards =============

/**
 * Check if an operator is a splitter
 */
export function isSplitter(operator: UnifiedOperator): boolean {
  return operator.type === 'splitting';
}

/**
 * Check if an operator is a preprocessing transform
 */
export function isPreprocessing(operator: UnifiedOperator): boolean {
  return operator.type === 'preprocessing';
}

/**
 * Count splitters in an operator array
 */
export function countSplitters(operators: UnifiedOperator[]): number {
  return operators.filter(isSplitter).length;
}
