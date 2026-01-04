/**
 * NodeRegistryContext - Context for node definitions (skeleton)
 *
 * This is a skeleton implementation for Phase 2 (Node Registry).
 * Currently provides a passthrough to the existing stepOptions,
 * but will be migrated to use JSON-based node definitions.
 *
 * Phase 1 Implementation - Foundation (skeleton)
 * @see docs/_internals/node_specifications.md
 * @see docs/_internals/implementation_roadmap.md
 *
 * Phase 2 will add:
 * - Loading node definitions from JSON files
 * - Schema validation at build time
 * - Custom node registration
 * - nirs4all synchronization
 *
 * @example
 * // Future usage (Phase 2)
 * const { getNodesByType, getNodeDefinition, resolveClassPath } = useNodeRegistry();
 * const preprocessingNodes = getNodesByType("preprocessing");
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { stepOptions, type StepType, type StepOption } from "../types";

/**
 * Node definition interface (Phase 2 will expand this).
 * Currently mirrors StepOption for backwards compatibility.
 */
export interface NodeDefinition {
  /** Unique identifier for the node */
  id: string;
  /** Display name */
  name: string;
  /** Node type category */
  type: StepType;
  /** Human-readable description */
  description: string;
  /** Default parameter values */
  defaultParams: Record<string, string | number | boolean>;
  /** Optional subcategory for palette organization */
  category?: string;
  /** Whether this is a deep learning model */
  isDeepLearning?: boolean;
  /** Whether this is an advanced/expert option */
  isAdvanced?: boolean;
  /** Searchable tags */
  tags?: string[];
  /** Full class path for nirs4all (Phase 2) */
  classPath?: string;
  /** Source of the definition */
  source?: "builtin" | "custom" | "nirs4all";
}

/**
 * Registry context value interface.
 */
export interface NodeRegistryContextValue {
  /** Get all nodes of a specific type */
  getNodesByType: (type: StepType) => NodeDefinition[];
  /** Get a specific node definition by type and name */
  getNodeDefinition: (type: StepType, name: string) => NodeDefinition | undefined;
  /** Get all node types */
  getNodeTypes: () => StepType[];
  /** Resolve class path for a node (Phase 2) */
  resolveClassPath: (type: StepType, name: string) => string | undefined;
  /** Check if registry is loading */
  isLoading: boolean;
  /** Any loading errors */
  error: Error | null;
  /** Registry version info */
  version: {
    registry: string;
    nirs4all?: string;
  };
}

// Create context with undefined default
const NodeRegistryContext = createContext<NodeRegistryContextValue | undefined>(undefined);

/**
 * Convert existing StepOption to NodeDefinition.
 * This is a temporary bridge until Phase 2 migrates to JSON definitions.
 */
function stepOptionToNodeDefinition(type: StepType, option: StepOption): NodeDefinition {
  return {
    id: `${type}.${option.name}`,
    name: option.name,
    type,
    description: option.description,
    defaultParams: option.defaultParams,
    category: option.category,
    isDeepLearning: option.isDeepLearning,
    isAdvanced: option.isAdvanced,
    tags: option.tags,
    source: "builtin",
  };
}

export interface NodeRegistryProviderProps {
  children: ReactNode;
  /**
   * Feature flag to enable registry-based loading.
   * When true, will use JSON definitions (Phase 2).
   * When false (default), uses existing stepOptions.
   */
  useJsonRegistry?: boolean;
}

/**
 * Provider component for node registry context.
 *
 * Currently provides a passthrough to stepOptions.
 * Phase 2 will add JSON-based loading with schema validation.
 */
export function NodeRegistryProvider({
  children,
  useJsonRegistry = false,
}: NodeRegistryProviderProps) {
  // TODO Phase 2: Load from JSON files when useJsonRegistry is true
  // const { data, isLoading, error } = useNodeDefinitions();

  const value = useMemo<NodeRegistryContextValue>(() => {
    // Phase 1: Use existing stepOptions as the data source
    const nodesByType = new Map<StepType, NodeDefinition[]>();

    // Convert stepOptions to NodeDefinitions
    for (const [type, options] of Object.entries(stepOptions) as [StepType, StepOption[]][]) {
      nodesByType.set(type, options.map((opt) => stepOptionToNodeDefinition(type, opt)));
    }

    return {
      getNodesByType: (type: StepType) => nodesByType.get(type) ?? [],

      getNodeDefinition: (type: StepType, name: string) => {
        const nodes = nodesByType.get(type);
        return nodes?.find((n) => n.name === name);
      },

      getNodeTypes: () => Array.from(nodesByType.keys()),

      resolveClassPath: (type: StepType, name: string) => {
        // Phase 2 will implement proper class path resolution
        // For now, return undefined (pipelineConverter handles this)
        const node = nodesByType.get(type)?.find((n) => n.name === name);
        return node?.classPath;
      },

      isLoading: false,
      error: null,
      version: {
        registry: "1.0.0-phase1",
      },
    };
  }, [useJsonRegistry]);

  return (
    <NodeRegistryContext.Provider value={value}>
      {children}
    </NodeRegistryContext.Provider>
  );
}

/**
 * Hook to access node registry context.
 *
 * Must be used within a NodeRegistryProvider.
 *
 * @throws Error if used outside of NodeRegistryProvider
 *
 * @example
 * function StepPalette() {
 *   const { getNodesByType } = useNodeRegistry();
 *   const preprocessingNodes = getNodesByType("preprocessing");
 *   return <NodeList nodes={preprocessingNodes} />;
 * }
 */
export function useNodeRegistry(): NodeRegistryContextValue {
  const context = useContext(NodeRegistryContext);

  if (context === undefined) {
    throw new Error("useNodeRegistry must be used within a NodeRegistryProvider");
  }

  return context;
}

/**
 * Hook to access node registry with optional fallback.
 *
 * Useful for components that may be used both inside and outside
 * the node registry context.
 *
 * @returns The context value or undefined if not within a provider
 */
export function useNodeRegistryOptional(): NodeRegistryContextValue | undefined {
  return useContext(NodeRegistryContext);
}
