/**
 * Registry Integration for Pipeline Converter
 *
 * This module provides utility functions to integrate the NodeRegistry
 * with the pipelineConverter's class path resolution. It allows the
 * converter to use the JSON-based registry while maintaining backwards
 * compatibility with the hardcoded mappings.
 *
 * @see docs/_internals/implementation_roadmap.md Task 2.16
 */

import type { NodeRegistry } from '@/data/nodes/NodeRegistry';
import type { StepType } from '@/components/pipeline-editor/types';

/**
 * Options for creating a registry-based class path resolver
 */
export interface RegistryResolverOptions {
  /** Fallback mappings for paths not in registry */
  fallbackMappings?: Record<string, { name: string; type: StepType }>;
  /** Whether to warn on fallback usage */
  warnOnFallback?: boolean;
}

/**
 * Create a class path resolver using the NodeRegistry
 */
export function createClassPathResolver(
  registry: NodeRegistry,
  options: RegistryResolverOptions = {}
) {
  const { fallbackMappings = {}, warnOnFallback = false } = options;

  /**
   * Resolve a class path to a node name and type
   */
  function resolveClassPath(classPath: string): { name: string; type: StepType } | undefined {
    // Try registry first
    const node = registry.getByClassPath(classPath);
    if (node) {
      return { name: node.name, type: node.type as StepType };
    }

    // Try fallback mappings
    if (fallbackMappings[classPath]) {
      if (warnOnFallback) {
        console.warn(`[RegistryResolver] Using fallback for classPath: ${classPath}`);
      }
      return fallbackMappings[classPath];
    }

    // Try to infer from path
    const className = classPath.split('.').pop() ?? classPath;

    if (classPath.includes('model_selection') || classPath.includes('splitters')) {
      return { name: className, type: 'splitting' };
    }
    if (classPath.includes('cross_decomposition') || classPath.includes('ensemble') ||
        classPath.includes('linear_model') || classPath.includes('svm') ||
        classPath.includes('models')) {
      return { name: className, type: 'model' };
    }
    if (classPath.includes('preprocessing') || classPath.includes('decomposition') ||
        classPath.includes('transforms')) {
      return { name: className, type: 'preprocessing' };
    }
    if (classPath.includes('augmentation')) {
      return { name: className, type: 'augmentation' };
    }
    if (classPath.includes('filters')) {
      return { name: className, type: 'filter' };
    }

    return undefined;
  }

  /**
   * Resolve a node name and type to a class path
   */
  function resolveNameToClassPath(type: StepType, name: string): string | undefined {
    // Try registry
    const classPath = registry.resolveClassPath(type, name);
    if (classPath) {
      return classPath;
    }

    // Try fallback mappings (reverse lookup)
    const key = `${type}:${name}`;
    for (const [path, info] of Object.entries(fallbackMappings)) {
      if (`${info.type}:${info.name}` === key) {
        return path;
      }
    }

    return undefined;
  }

  /**
   * Build complete class path mappings from registry
   * (for migration: export what registry knows)
   */
  function buildClassPathMappings(): Record<string, { name: string; type: StepType }> {
    const mappings: Record<string, { name: string; type: StepType }> = {};

    for (const node of registry.getAll()) {
      if (node.classPath) {
        mappings[node.classPath] = { name: node.name, type: node.type as StepType };
      }
      if (node.legacyClassPaths) {
        for (const legacyPath of node.legacyClassPaths) {
          mappings[legacyPath] = { name: node.name, type: node.type as StepType };
        }
      }
    }

    return mappings;
  }

  /**
   * Build name-to-classPath mappings from registry
   */
  function buildNameToClassPathMappings(): Record<string, string> {
    const mappings: Record<string, string> = {};

    for (const node of registry.getAll()) {
      if (node.classPath) {
        const key = `${node.type}:${node.name}`;
        mappings[key] = node.classPath;
      }
    }

    return mappings;
  }

  return {
    resolveClassPath,
    resolveNameToClassPath,
    buildClassPathMappings,
    buildNameToClassPathMappings,
  };
}

/**
 * Merge registry mappings with hardcoded mappings.
 * Registry takes precedence.
 */
export function mergeClassPathMappings(
  registryMappings: Record<string, { name: string; type: StepType }>,
  hardcodedMappings: Record<string, { name: string; type: StepType }>
): Record<string, { name: string; type: StepType }> {
  // Start with hardcoded, then overlay registry
  return {
    ...hardcodedMappings,
    ...registryMappings,
  };
}

/**
 * Compare registry mappings with hardcoded mappings for migration validation.
 * Returns differences for debugging.
 */
export function compareClassPathMappings(
  registryMappings: Record<string, { name: string; type: StepType }>,
  hardcodedMappings: Record<string, { name: string; type: StepType }>
): {
  onlyInRegistry: string[];
  onlyInHardcoded: string[];
  conflicts: Array<{ path: string; registry: { name: string; type: StepType }; hardcoded: { name: string; type: StepType } }>;
} {
  const registryPaths = new Set(Object.keys(registryMappings));
  const hardcodedPaths = new Set(Object.keys(hardcodedMappings));

  const onlyInRegistry: string[] = [];
  const onlyInHardcoded: string[] = [];
  const conflicts: Array<{ path: string; registry: { name: string; type: StepType }; hardcoded: { name: string; type: StepType } }> = [];

  for (const path of registryPaths) {
    if (!hardcodedPaths.has(path)) {
      onlyInRegistry.push(path);
    } else {
      const r = registryMappings[path];
      const h = hardcodedMappings[path];
      if (r.name !== h.name || r.type !== h.type) {
        conflicts.push({ path, registry: r, hardcoded: h });
      }
    }
  }

  for (const path of hardcodedPaths) {
    if (!registryPaths.has(path)) {
      onlyInHardcoded.push(path);
    }
  }

  return { onlyInRegistry, onlyInHardcoded, conflicts };
}
