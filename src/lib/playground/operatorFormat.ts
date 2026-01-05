/**
 * Operator format conversion utilities
 *
 * Converts between legacy frontend format and unified operator format.
 * Also provides conversion to/from Pipeline Editor format.
 */

import type {
  UnifiedOperator,
  PlaygroundStep,
  OperatorDefinition,
} from '@/types/playground';
import type { PipelineOperator, OperatorType } from '@/types/spectral';

// ============= Legacy to Unified Conversion =============

/**
 * Mapping from legacy frontend operator types to nirs4all class names
 */
const LEGACY_TO_NIRS4ALL: Record<OperatorType, { name: string; type: 'preprocessing' | 'splitting' }> = {
  snv: { name: 'StandardNormalVariate', type: 'preprocessing' },
  msc: { name: 'MultiplicativeScatterCorrection', type: 'preprocessing' },
  savgol: { name: 'SavitzkyGolay', type: 'preprocessing' },
  derivative1: { name: 'FirstDerivative', type: 'preprocessing' },
  derivative2: { name: 'SecondDerivative', type: 'preprocessing' },
  smoothing: { name: 'Gaussian', type: 'preprocessing' },
  meanCenter: { name: 'StandardScaler', type: 'preprocessing' },
  normalize: { name: 'Normalize', type: 'preprocessing' },
  baseline: { name: 'Baseline', type: 'preprocessing' },
  detrend: { name: 'Detrend', type: 'preprocessing' },
  wavelengthSelect: { name: 'CropTransformer', type: 'preprocessing' },
};

/**
 * Mapping from nirs4all class names to legacy frontend types
 */
const NIRS4ALL_TO_LEGACY: Record<string, OperatorType> = {
  StandardNormalVariate: 'snv',
  MultiplicativeScatterCorrection: 'msc',
  SavitzkyGolay: 'savgol',
  FirstDerivative: 'derivative1',
  SecondDerivative: 'derivative2',
  Gaussian: 'smoothing',
  StandardScaler: 'meanCenter',
  Normalize: 'normalize',
  Baseline: 'baseline',
  Detrend: 'detrend',
  CropTransformer: 'wavelengthSelect',
};

/**
 * Parameter name mapping from legacy to nirs4all
 */
const PARAM_MAPPING: Record<string, Record<string, string>> = {
  savgol: {
    windowSize: 'window_length',
    polyOrder: 'polyorder',
  },
  derivative1: {
    windowSize: 'window_length',
    polyOrder: 'polyorder',
  },
  derivative2: {
    windowSize: 'window_length',
    polyOrder: 'polyorder',
  },
  smoothing: {
    windowSize: 'window_length',
    method: 'mode',
  },
  msc: {
    referenceType: 'reference',
  },
  normalize: {
    method: 'norm',
  },
  baseline: {
    polyOrder: 'poly_order',
    lambda: 'lam',
    p: 'p',
  },
  wavelengthSelect: {
    ranges: 'wavelengths',
    exclude: 'invert',
  },
};

/**
 * Convert a legacy PipelineOperator to UnifiedOperator
 */
export function legacyToUnified(legacy: PipelineOperator): UnifiedOperator {
  const mapping = LEGACY_TO_NIRS4ALL[legacy.type];
  if (!mapping) {
    // Unknown operator - pass through with a warning
    console.warn(`Unknown legacy operator type: ${legacy.type}`);
    return {
      id: legacy.id,
      type: 'preprocessing',
      name: legacy.type,
      params: legacy.params as Record<string, unknown>,
      enabled: legacy.enabled,
    };
  }

  // Convert parameters
  const paramMapping = PARAM_MAPPING[legacy.type] || {};
  const convertedParams: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(legacy.params)) {
    const newKey = paramMapping[key] || key;
    convertedParams[newKey] = value;
  }

  return {
    id: legacy.id,
    type: mapping.type,
    name: mapping.name,
    params: convertedParams,
    enabled: legacy.enabled,
  };
}

/**
 * Convert a UnifiedOperator to legacy PipelineOperator
 * Used for backward compatibility with existing components
 */
export function unifiedToLegacy(unified: UnifiedOperator): PipelineOperator | null {
  const legacyType = NIRS4ALL_TO_LEGACY[unified.name];

  if (!legacyType) {
    // This operator has no legacy equivalent (e.g., splitters)
    return null;
  }

  // Reverse parameter mapping
  const paramMapping = PARAM_MAPPING[legacyType] || {};
  const reverseMapping: Record<string, string> = {};
  for (const [legacyKey, nirs4allKey] of Object.entries(paramMapping)) {
    reverseMapping[nirs4allKey] = legacyKey;
  }

  const convertedParams: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(unified.params)) {
    const legacyKey = reverseMapping[key] || key;
    convertedParams[legacyKey] = value;
  }

  return {
    id: unified.id,
    type: legacyType,
    params: convertedParams,
    enabled: unified.enabled,
    name: unified.name,
    target: 'X', // Default target
  } as PipelineOperator;
}

// ============= Unified to API Conversion =============

/**
 * Convert UnifiedOperator to PlaygroundStep for API calls
 */
export function unifiedToPlaygroundStep(operator: UnifiedOperator): PlaygroundStep {
  return {
    id: operator.id,
    type: operator.type,
    name: operator.name,
    params: operator.params,
    enabled: operator.enabled,
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
  type: 'preprocessing' | 'splitting' | 'model' | 'branch' | 'generator';
  name: string;
  params: Record<string, unknown>;
  branches?: PipelineEditorStep[][];
  paramSweeps?: Record<string, unknown>;
}

/**
 * Convert UnifiedOperator to Pipeline Editor format
 */
export function unifiedToEditorStep(operator: UnifiedOperator): PipelineEditorStep {
  return {
    id: operator.id,
    type: operator.type,
    name: operator.name,
    params: operator.params,
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

  if (step.type !== 'preprocessing' && step.type !== 'splitting') {
    return null;
  }

  return {
    id: step.id,
    type: step.type,
    name: step.name,
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

/** Key used in sessionStorage for pipeline export */
export const PLAYGROUND_EXPORT_KEY = 'playground-pipeline-export';

/**
 * Data stored in sessionStorage when exporting to Pipeline Editor
 */
export interface PlaygroundExportData {
  name: string;
  description?: string;
  steps: PipelineEditorStep[];
  timestamp: number;
  source: 'playground';
}

/**
 * Prepare export data and store in sessionStorage.
 * Returns the export data for confirmation or the path to navigate to.
 * Throws an error if sessionStorage is unavailable or full.
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

  // Store in sessionStorage for the Pipeline Editor to pick up
  try {
    sessionStorage.setItem(PLAYGROUND_EXPORT_KEY, JSON.stringify(exportData));
  } catch (e) {
    // sessionStorage might be full or unavailable (private browsing mode in some browsers)
    console.error('Failed to store export data in sessionStorage:', e);
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
  try {
    const data = sessionStorage.getItem(PLAYGROUND_EXPORT_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch (e) {
    console.warn('Failed to parse playground export data:', e);
  }
  return null;
}

/**
 * Clear the playground export data after it's been consumed
 */
export function clearPlaygroundExportData(): void {
  sessionStorage.removeItem(PLAYGROUND_EXPORT_KEY);
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
