/**
 * Pure node registry indexing and resolution helpers.
 *
 * This module is intentionally independent from React, storage, and category UI
 * concerns so future registry backends can reuse the same merge/index semantics.
 */

import type { NodeDefinition, NodeType } from './types';

export type NodeCapability = 'deepLearning' | 'container' | 'generator';
export type NodeTierFilter = 'core' | 'standard' | 'all';

export interface NodeRegistryStats {
  totalNodes: number;
  nodesByType: Record<string, number>;
  classPathCount: number;
}

function cloneNodeDefinition(node: NodeDefinition): NodeDefinition {
  return {
    ...node,
    legacyClassPaths: node.legacyClassPaths ? [...node.legacyClassPaths] : undefined,
  };
}

export function normalizeClassPath(path: string | undefined): string | null {
  const normalized = path?.trim().toLowerCase();
  return normalized ? normalized : null;
}

export function getClassPathAliases(node: NodeDefinition): string[] {
  const aliases = new Set<string>();
  const classPath = normalizeClassPath(node.classPath);
  if (classPath) {
    aliases.add(classPath);
  }
  for (const legacyPath of node.legacyClassPaths ?? []) {
    const normalized = normalizeClassPath(legacyPath);
    if (normalized) {
      aliases.add(normalized);
    }
  }
  return Array.from(aliases);
}

export function getTypeNameKey(node: NodeDefinition): string {
  return `${String(node.type).toLowerCase()}::${node.name.toLowerCase()}`;
}

function mergeClassPathAliases(target: NodeDefinition, incoming: NodeDefinition): void {
  const targetClassPath = normalizeClassPath(target.classPath);
  const existingLegacy = new Set((target.legacyClassPaths ?? []).map((path) => path.toLowerCase()));
  const mergedLegacy = [...(target.legacyClassPaths ?? [])];

  const maybeAdd = (path: string | undefined) => {
    const normalized = normalizeClassPath(path);
    if (!normalized || normalized === targetClassPath || existingLegacy.has(normalized)) {
      return;
    }
    mergedLegacy.push(path!);
    existingLegacy.add(normalized);
  };

  maybeAdd(incoming.classPath);
  for (const legacyPath of incoming.legacyClassPaths ?? []) {
    maybeAdd(legacyPath);
  }

  target.legacyClassPaths = mergedLegacy.length > 0 ? mergedLegacy : undefined;
}

/**
 * Merge incoming node definitions into a preferred set while suppressing
 * semantic duplicates. Preferred nodes always win.
 *
 * Duplicate detection is based on:
 * - exact node ID
 * - any overlapping classPath / legacyClassPaths alias
 * - matching type + name (case-insensitive)
 *
 * When a duplicate is skipped, any new classPath aliases from the incoming
 * node are merged into the preferred node's `legacyClassPaths`.
 */
export function mergeNodeDefinitions(
  preferredNodes: NodeDefinition[],
  incomingNodes: NodeDefinition[]
): NodeDefinition[] {
  const mergedNodes = preferredNodes.map(cloneNodeDefinition);
  const nodesById = new Map<string, number>();
  const nodesByAlias = new Map<string, number>();
  const nodesByTypeName = new Map<string, number>();

  const registerNode = (node: NodeDefinition, index: number) => {
    nodesById.set(node.id, index);
    nodesByTypeName.set(getTypeNameKey(node), index);
    for (const alias of getClassPathAliases(node)) {
      nodesByAlias.set(alias, index);
    }
  };

  mergedNodes.forEach((node, index) => registerNode(node, index));

  for (const incomingNode of incomingNodes) {
    const candidate = cloneNodeDefinition(incomingNode);
    let duplicateIndex = nodesById.get(candidate.id);

    if (duplicateIndex === undefined) {
      for (const alias of getClassPathAliases(candidate)) {
        duplicateIndex = nodesByAlias.get(alias);
        if (duplicateIndex !== undefined) {
          break;
        }
      }
    }

    if (duplicateIndex === undefined) {
      duplicateIndex = nodesByTypeName.get(getTypeNameKey(candidate));
    }

    if (duplicateIndex !== undefined) {
      mergeClassPathAliases(mergedNodes[duplicateIndex], candidate);
      registerNode(mergedNodes[duplicateIndex], duplicateIndex);
      continue;
    }

    const nextIndex = mergedNodes.length;
    mergedNodes.push(candidate);
    registerNode(candidate, nextIndex);
  }

  return mergedNodes;
}

export function nodeHasCapability(node: NodeDefinition, capability: NodeCapability): boolean {
  switch (capability) {
    case 'deepLearning':
      return node.isDeepLearning === true;
    case 'container':
      return node.isContainer === true;
    case 'generator':
      return node.isGenerator === true;
  }
}

export function nodeMatchesSearch(node: NodeDefinition, query: string): boolean {
  const lowerQuery = query.toLowerCase();
  return (
    node.name.toLowerCase().includes(lowerQuery) ||
    node.description.toLowerCase().includes(lowerQuery) ||
    node.tags?.some(t => t.toLowerCase().includes(lowerQuery)) === true ||
    node.category?.toLowerCase().includes(lowerQuery) === true
  );
}

/**
 * Deterministic, in-memory indexes over a node definition set.
 */
export class NodeRegistryIndex {
  private readonly nodesById: Map<string, NodeDefinition>;
  private readonly nodesByClassPath: Map<string, NodeDefinition>;
  private readonly nodesByType: Map<NodeType, NodeDefinition[]>;
  private readonly nodesByName: Map<string, NodeDefinition>;

  constructor(nodes: NodeDefinition[]) {
    this.nodesById = new Map();
    this.nodesByClassPath = new Map();
    this.nodesByType = new Map();
    this.nodesByName = new Map();

    this.load(nodes);
  }

  private load(nodes: NodeDefinition[]): void {
    for (const node of nodes) {
      if (this.nodesById.has(node.id)) {
        continue;
      }

      this.nodesById.set(node.id, node);

      if (node.classPath) {
        this.nodesByClassPath.set(node.classPath, node);
      }

      for (const legacyPath of node.legacyClassPaths ?? []) {
        if (!this.nodesByClassPath.has(legacyPath)) {
          this.nodesByClassPath.set(legacyPath, node);
        }
      }

      const typeNodes = this.nodesByType.get(node.type) ?? [];
      typeNodes.push(node);
      this.nodesByType.set(node.type, typeNodes);

      const lowerName = node.name.toLowerCase();
      if (!this.nodesByName.has(lowerName)) {
        this.nodesByName.set(lowerName, node);
      }
    }
  }

  getById(id: string): NodeDefinition | undefined {
    return this.nodesById.get(id);
  }

  getByName(name: string): NodeDefinition | undefined {
    return this.nodesByName.get(name.toLowerCase());
  }

  getByClassPath(classPath: string): NodeDefinition | undefined {
    return this.nodesByClassPath.get(classPath);
  }

  getByType(type: NodeType): NodeDefinition[] {
    return this.nodesByType.get(type) ?? [];
  }

  getByTypeAndName(type: NodeType, name: string): NodeDefinition | undefined {
    return this.getByType(type).find(n => n.name === name);
  }

  has(id: string): boolean {
    return this.nodesById.has(id);
  }

  hasClassPath(classPath: string): boolean {
    return this.nodesByClassPath.has(classPath);
  }

  getTypes(): NodeType[] {
    return Array.from(this.nodesByType.keys());
  }

  getAll(): NodeDefinition[] {
    return Array.from(this.nodesById.values());
  }

  get size(): number {
    return this.nodesById.size;
  }

  getByCategory(category: string): NodeDefinition[] {
    return this.getAll().filter(node => node.category === category);
  }

  getBySource(source: string): NodeDefinition[] {
    return this.getAll().filter(node => node.source === source);
  }

  getByTags(tags: string[]): NodeDefinition[] {
    const tagSet = new Set(tags.map(t => t.toLowerCase()));
    return this.getAll().filter(node =>
      node.tags?.some(t => tagSet.has(t.toLowerCase()))
    );
  }

  search(query: string): NodeDefinition[] {
    if (!query.trim()) return this.getAll();
    return this.getAll().filter(node => nodeMatchesSearch(node, query));
  }

  getNodesByTier(maxTier: NodeTierFilter): NodeDefinition[] {
    if (maxTier === 'all') return this.getAll();
    if (maxTier === 'core') return this.getAll().filter(n => n.tier === 'core');
    return this.getAll().filter(n => n.tier !== 'advanced');
  }

  getByTypeAndTier(type: NodeType, maxTier: NodeTierFilter): NodeDefinition[] {
    const nodes = this.getByType(type);
    if (maxTier === 'all') return nodes;
    if (maxTier === 'core') return nodes.filter(n => n.tier === 'core');
    return nodes.filter(n => n.tier !== 'advanced');
  }

  getByCapability(capability: NodeCapability): NodeDefinition[] {
    return this.getAll().filter(node => nodeHasCapability(node, capability));
  }

  resolveClassPath(type: NodeType, name: string): string | undefined {
    return this.getByTypeAndName(type, name)?.classPath;
  }

  resolveNameFromClassPath(classPath: string): string | undefined {
    return this.getByClassPath(classPath)?.name;
  }

  buildClassPathToNameMap(): Map<string, string> {
    const map = new Map<string, string>();

    for (const node of this.getAll()) {
      if (node.classPath) {
        map.set(node.classPath, node.name);
      }
      for (const legacyPath of node.legacyClassPaths ?? []) {
        map.set(legacyPath, node.name);
      }
    }

    return map;
  }

  buildNameToClassPathMap(): Map<string, string> {
    const map = new Map<string, string>();

    for (const node of this.getAll()) {
      if (node.classPath) {
        map.set(node.name, node.classPath);
      }
    }

    return map;
  }

  getStats(): NodeRegistryStats {
    const nodesByType: Record<string, number> = {};
    for (const [type, nodes] of this.nodesByType) {
      nodesByType[type] = nodes.length;
    }

    return {
      totalNodes: this.size,
      nodesByType,
      classPathCount: this.nodesByClassPath.size,
    };
  }
}
