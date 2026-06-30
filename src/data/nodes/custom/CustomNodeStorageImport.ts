import type { CustomNodesFile, NodeDefinition } from '../types';
import { isCustomNodesFile } from './CustomNodeStoragePolicy';

export type CustomNodeImportMode = 'merge' | 'replace';

export interface CustomNodeImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export type CustomNodeImportValidator = (node: NodeDefinition) => {
  valid: boolean;
  errors: string[];
};

export type CustomNodesFileParseResult =
  | { success: true; data: CustomNodesFile }
  | { success: false };

export function applyCustomNodesImport(
  targetNodes: Map<string, NodeDefinition>,
  data: CustomNodesFile,
  validate: CustomNodeImportValidator,
  mode: CustomNodeImportMode = 'merge'
): CustomNodeImportResult {
  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;

  if (!isCustomNodesFile(data)) {
    errors.push('Invalid file format');
    return { imported: 0, skipped: 0, errors };
  }

  if (mode === 'replace') {
    targetNodes.clear();
  }

  for (const node of data.nodes) {
    try {
      const validation = validate(node);
      if (!validation.valid) {
        errors.push(`${node.id || 'unknown'}: ${validation.errors.join(', ')}`);
        skipped++;
        continue;
      }

      if (mode === 'merge' && targetNodes.has(node.id)) {
        skipped++;
        continue;
      }

      targetNodes.set(node.id, { ...node, source: 'custom' });
      imported++;
    } catch (err) {
      errors.push(`${node.id || 'unknown'}: ${(err as Error).message}`);
      skipped++;
    }
  }

  return { imported, skipped, errors };
}

export function parseCustomNodesFile(jsonString: string): CustomNodesFileParseResult {
  try {
    return { success: true, data: JSON.parse(jsonString) as CustomNodesFile };
  } catch {
    return { success: false };
  }
}
