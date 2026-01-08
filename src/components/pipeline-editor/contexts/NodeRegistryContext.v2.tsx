/**
 * NodeRegistryContext - Context for node definitions
 *
 * Phase 2 Implementation - Full Node Registry
 *
 * Provides a React context for accessing node definitions from the JSON-based
 * registry. Supports both legacy stepOptions (Phase 1) and new JSON definitions
 * (Phase 2) via a feature flag.
 *
 * @see docs/_internals/node_specifications.md
 * @see docs/_internals/implementation_roadmap.md Tasks 2.11-2.12
 *
 * @example
 * import { useNodeRegistry } from './contexts/NodeRegistryContext';
 *
 * function MyComponent() {
 *   const { getNodesByType, getNodeDefinition, resolveClassPath } = useNodeRegistry();
 *   const preprocessingNodes = getNodesByType("preprocessing");
 *   const plsClassPath = resolveClassPath("model", "PLSRegression");
 * }
 */

import { createContext, useContext, useMemo, useState, useEffect, useRef, type ReactNode } from "react";
import { stepOptions, type StepType, type StepOption } from "../types";
import { usePipelineEditorPreferencesOptional } from "./PipelineEditorPreferencesContext";

// Import from the new node registry system
import {
  NodeRegistry,
  createNodeRegistry,
  CustomNodeStorage,
  type NodeDefinition as JsonNodeDefinition,
  type ParameterDefinition,
  type NodeType,
  type CategoryConfig,
} from "@/data/nodes";

// ============================================================================
// Feature Flag
// ============================================================================

/**
 * Feature flag to enable JSON-based node registry.
 * Set via environment variable or prop.
 * Defaults to TRUE since Phase 2 is fully implemented.
 */
export const USE_NODE_REGISTRY =
  import.meta.env.VITE_USE_NODE_REGISTRY !== 'false' &&
  import.meta.env.VITE_USE_NODE_REGISTRY !== false;

// ============================================================================
// Types
// ============================================================================

/**
 * Node definition interface - unified between legacy and new systems.
 * Provides a common interface that works with both StepOption and JsonNodeDefinition.
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
  /** Parameter definitions (Phase 2) */
  parameters?: ParameterDefinition[];
  /** Optional subcategory for palette organization */
  category?: string;
  /** Whether this is a deep learning model */
  isDeepLearning?: boolean;
  /** Whether this is an advanced/expert option */
  isAdvanced?: boolean;
  /** Searchable tags */
  tags?: string[];
  /** Full class path for nirs4all */
  classPath?: string;
  /** Source of the definition */
  source?: "builtin" | "custom" | "nirs4all" | "sklearn" | "editor";
  /** Legacy class paths for backwards compatibility */
  legacyClassPaths?: string[];
  /** Whether this is a container node */
  isContainer?: boolean;
  /** Whether this is a generator node */
  isGenerator?: boolean;
  /** Color scheme for the node type */
  colorScheme?: CategoryConfig['color'];
}

/**
 * Registry context value interface.
 */
export interface NodeRegistryContextValue {
  /** Get all nodes of a specific type */
  getNodesByType: (type: StepType) => NodeDefinition[];
  /** Get a specific node definition by type and name */
  getNodeDefinition: (type: StepType, name: string) => NodeDefinition | undefined;
  /** Get a node by its unique ID */
  getNodeById: (id: string) => NodeDefinition | undefined;
  /** Get a node by its classPath */
  getNodeByClassPath: (classPath: string) => NodeDefinition | undefined;
  /** Get all node types */
  getNodeTypes: () => StepType[];
  /** Resolve class path for a node */
  resolveClassPath: (type: StepType, name: string) => string | undefined;
  /** Resolve node name from a classPath */
  resolveNameFromClassPath: (classPath: string) => string | undefined;
  /** Search nodes by query string */
  searchNodes: (query: string) => NodeDefinition[];
  /** Get default parameters for a node */
  getDefaultParams: (type: StepType, name: string) => Record<string, unknown>;
  /** Get parameter definition */
  getParameterDef: (type: StepType, name: string, paramName: string) => ParameterDefinition | undefined;
  /** Get sweepable parameters for a node */
  getSweepableParams: (type: StepType, name: string) => ParameterDefinition[];
  /** Get category configuration */
  getCategoryConfig: (type: StepType) => CategoryConfig | undefined;
  /** Check if registry is loading */
  isLoading: boolean;
  /** Any loading errors */
  error: Error | null;
  /** Whether using JSON registry (true) or legacy stepOptions (false) */
  isJsonRegistry: boolean;
  /** Registry version info */
  version: {
    registry: string;
    nirs4all?: string;
  };
  /** Underlying NodeRegistry instance (Phase 2 only) */
  registry: NodeRegistry | null;
}

// ============================================================================
// Context
// ============================================================================

const NodeRegistryContext = createContext<NodeRegistryContextValue | undefined>(undefined);

// ============================================================================
// Legacy Conversion
// ============================================================================

/**
 * Convert existing StepOption to NodeDefinition.
 * Used when running in legacy mode (Phase 1 compatibility).
 */
function stepOptionToNodeDefinition(type: StepType, option: StepOption): NodeDefinition {
  return {
    id: `${type}.${option.name.toLowerCase().replace(/\s+/g, '_')}`,
    name: option.name,
    type,
    description: option.description,
    category: option.category,
    isDeepLearning: option.isDeepLearning,
    isAdvanced: option.isAdvanced,
    tags: option.tags,
    source: "builtin",
  };
}

/**
 * Convert JsonNodeDefinition to unified NodeDefinition format.
 */
function jsonNodeToNodeDefinition(node: JsonNodeDefinition): NodeDefinition {
  return {
    id: node.id,
    name: node.name,
    type: node.type as StepType,
    description: node.description,
    category: node.category,
    isDeepLearning: node.isDeepLearning,
    isAdvanced: node.isAdvanced,
    tags: node.tags,
    classPath: node.classPath,
    source: node.source as NodeDefinition['source'],
    legacyClassPaths: node.legacyClassPaths,
    parameters: node.parameters,
    isContainer: node.isContainer,
    isGenerator: node.isGenerator,
  };
}

// ============================================================================
// Provider Props
// ============================================================================

export interface NodeRegistryProviderProps {
  children: ReactNode;
  /**
   * Feature flag to enable registry-based loading.
   * When true, uses JSON definitions.
   * When false, uses existing stepOptions (legacy).
   * Defaults to USE_NODE_REGISTRY environment variable.
   */
  useJsonRegistry?: boolean;
}

// ============================================================================
// Provider Component
// ============================================================================

/**
 * Provider component for node registry context.
 *
 * Supports both legacy stepOptions and new JSON-based registry
 * via feature flag.
 */
export function NodeRegistryProvider({
  children,
  useJsonRegistry = USE_NODE_REGISTRY,
}: NodeRegistryProviderProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [registry, setRegistry] = useState<NodeRegistry | null>(null);

  const preferences = usePipelineEditorPreferencesOptional();
  const extendedMode = preferences?.extendedMode ?? false;

  const baseRegistryRef = useRef<NodeRegistry | null>(null);
  const [customNodes, setCustomNodes] = useState<JsonNodeDefinition[]>([]);

  const [extendedNodes, setExtendedNodes] = useState<JsonNodeDefinition[] | null>(null);
  const [isLoadingExtended, setIsLoadingExtended] = useState(false);
  const [extendedError, setExtendedError] = useState<Error | null>(null);

  // Ref to track if a fetch is in progress (avoids stale closure issues)
  const isFetchingExtendedRef = useRef(false);

  // If the user disables Extended mode, drop the cached extended registry.
  // This lets users toggle off/on to re-fetch after regenerating extended.json
  // while the app is running.
  useEffect(() => {
    if (!useJsonRegistry) return;
    if (extendedMode) return;
    setExtendedNodes(null);
    setExtendedError(null);
  }, [useJsonRegistry, extendedMode]);

  // Initialize base registry and subscribe to custom node updates.
  useEffect(() => {
    if (!useJsonRegistry) return;

    setIsLoading(true);
    try {
      const baseRegistry = createNodeRegistry({
        validateOnLoad: import.meta.env.DEV, // Validate in dev mode
        warnOnDuplicates: true,
      });

      baseRegistryRef.current = baseRegistry;

      const storage = CustomNodeStorage.getInstance();
      setCustomNodes(storage.getAllMerged());

      const unsubscribe = storage.subscribe(() => {
        setCustomNodes(storage.getAllMerged());
      });

      setError(null);
      return unsubscribe;
    } catch (e) {
      setError(e instanceof Error ? e : new Error("Failed to load node registry"));
      console.error("[NodeRegistry] Failed to initialize:", e);
      baseRegistryRef.current = null;
    } finally {
      setIsLoading(false);
    }

    return;
  }, [useJsonRegistry]);

  // Lazy-load extended registry when Extended mode is enabled.
  useEffect(() => {
    if (!useJsonRegistry) return;
    if (!extendedMode) return;
    if (extendedNodes !== null) return;
    if (isFetchingExtendedRef.current) return;

    isFetchingExtendedRef.current = true;
    const abort = new AbortController();
    const load = async () => {
      setIsLoadingExtended(true);
      setExtendedError(null);
      try {
        const res = await fetch("/node-registry/extended.json", {
          signal: abort.signal,
          headers: {
            Accept: "application/json",
          },
        });

        if (!res.ok) {
          throw new Error(`Failed to load extended registry: ${res.status} ${res.statusText}`);
        }

        const data: unknown = await res.json();
        if (!Array.isArray(data)) {
          throw new Error("Extended registry JSON must be an array of node definitions");
        }

        setExtendedNodes(data as JsonNodeDefinition[]);
      } catch (e) {
        if (abort.signal.aborted) return;
        const err = e instanceof Error ? e : new Error("Failed to load extended registry");
        setExtendedError(err);
        console.error("[NodeRegistry] Failed to load extended registry:", err);
      } finally {
        if (!abort.signal.aborted) {
          setIsLoadingExtended(false);
          isFetchingExtendedRef.current = false;
        }
      }
    };

    void load();
    return () => {
      abort.abort();
      isFetchingExtendedRef.current = false;
    };
  }, [useJsonRegistry, extendedMode, extendedNodes]);

  // Build the merged registry whenever base/custom/extended nodes change.
  useEffect(() => {
    if (!useJsonRegistry) return;
    const baseRegistry = baseRegistryRef.current;
    if (!baseRegistry) return;

    // Merge ordering (first wins on duplicate IDs): base > custom > extended
    const mergedNodes: JsonNodeDefinition[] = [
      ...baseRegistry.getAll(),
      ...customNodes,
      ...(extendedMode ? (extendedNodes ?? []) : []),
    ];

    const mergedRegistry = new NodeRegistry(mergedNodes, {
      validateOnLoad: import.meta.env.DEV,
      warnOnDuplicates: true,
    });

    setRegistry(mergedRegistry);

    if (import.meta.env.DEV) {
      console.log(
        "[NodeRegistry] Built (merged)",
        { extendedMode, extendedCount: extendedNodes?.length ?? 0, customCount: customNodes.length },
        mergedRegistry.getStats()
      );
    }
  }, [useJsonRegistry, customNodes, extendedMode, extendedNodes]);

  const value = useMemo<NodeRegistryContextValue>(() => {
    if (useJsonRegistry && registry) {
      // Phase 2: Use JSON-based registry
      return {
        getNodesByType: (type: StepType) =>
          registry.getByType(type as NodeType).map(jsonNodeToNodeDefinition),

        getNodeDefinition: (type: StepType, name: string) => {
          const node = registry.getByTypeAndName(type as NodeType, name);
          return node ? jsonNodeToNodeDefinition(node) : undefined;
        },

        getNodeById: (id: string) => {
          const node = registry.getById(id);
          return node ? jsonNodeToNodeDefinition(node) : undefined;
        },

        getNodeByClassPath: (classPath: string) => {
          const node = registry.getByClassPath(classPath);
          return node ? jsonNodeToNodeDefinition(node) : undefined;
        },

        getNodeTypes: () => registry.getTypes() as StepType[],

        resolveClassPath: (type: StepType, name: string) =>
          registry.resolveClassPath(type as NodeType, name),

        resolveNameFromClassPath: (classPath: string) =>
          registry.resolveNameFromClassPath(classPath),

        searchNodes: (query: string) =>
          registry.search(query).map(jsonNodeToNodeDefinition),

        getDefaultParams: (type: StepType, name: string) => {
          const node = registry.getByTypeAndName(type as NodeType, name);
          if (!node) return {};
          return registry.getDefaultParams(node.id);
        },

        getParameterDef: (type: StepType, name: string, paramName: string) => {
          const node = registry.getByTypeAndName(type as NodeType, name);
          if (!node) return undefined;
          return registry.getParameterDef(node.id, paramName);
        },

        getSweepableParams: (type: StepType, name: string) => {
          const node = registry.getByTypeAndName(type as NodeType, name);
          if (!node) return [];
          return registry.getSweepableParams(node.id);
        },

        getCategoryConfig: (type: StepType) =>
          registry.getCategoryConfig(type as NodeType),

        isLoading: isLoading || isLoadingExtended,
        error: error ?? (extendedMode ? extendedError : null),
        isJsonRegistry: true,
        version: {
          registry: registry.version,
        },
        registry,
      };
    }

    // Phase 1: Use existing stepOptions as the data source (legacy mode)
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

      getNodeById: (id: string) => {
        for (const nodes of nodesByType.values()) {
          const found = nodes.find(n => n.id === id);
          if (found) return found;
        }
        return undefined;
      },

      getNodeByClassPath: (classPath: string) => {
        for (const nodes of nodesByType.values()) {
          const found = nodes.find(n => n.classPath === classPath);
          if (found) return found;
        }
        return undefined;
      },

      getNodeTypes: () => Array.from(nodesByType.keys()),

      resolveClassPath: (type: StepType, name: string) => {
        const node = nodesByType.get(type)?.find((n) => n.name === name);
        return node?.classPath;
      },

      resolveNameFromClassPath: (classPath: string) => {
        for (const nodes of nodesByType.values()) {
          const found = nodes.find(n => n.classPath === classPath);
          if (found) return found.name;
        }
        return undefined;
      },

      searchNodes: (query: string) => {
        const lowerQuery = query.toLowerCase();
        const results: NodeDefinition[] = [];
        for (const nodes of nodesByType.values()) {
          for (const node of nodes) {
            if (
              node.name.toLowerCase().includes(lowerQuery) ||
              node.description.toLowerCase().includes(lowerQuery) ||
              node.tags?.some(t => t.toLowerCase().includes(lowerQuery))
            ) {
              results.push(node);
            }
          }
        }
        return results;
      },

      getDefaultParams: (type: StepType, name: string) => {
        const node = nodesByType.get(type)?.find((n) => n.name === name);
        return node?.defaultParams ?? {};
      },

      getParameterDef: () => undefined, // Not available in legacy mode

      getSweepableParams: () => [], // Not available in legacy mode

      getCategoryConfig: () => undefined, // Not available in legacy mode

      isLoading: false,
      error: null,
      isJsonRegistry: false,
      version: {
        registry: "1.0.0-legacy",
      },
      registry: null,
    };
  }, [
    useJsonRegistry,
    registry,
    isLoading,
    error,
    isLoadingExtended,
    extendedMode,
    extendedError,
  ]);

  return (
    <NodeRegistryContext.Provider value={value}>
      {children}
    </NodeRegistryContext.Provider>
  );
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to access node registry context.
 *
 * Must be used within a NodeRegistryProvider.
 *
 * @throws Error if used outside of NodeRegistryProvider
 *
 * @example
 * function StepPalette() {
 *   const { getNodesByType, searchNodes } = useNodeRegistry();
 *   const preprocessingNodes = getNodesByType("preprocessing");
 *   const searchResults = searchNodes("pls");
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

/**
 * Hook to get nodes of a specific type.
 * Convenience wrapper around useNodeRegistry.
 */
export function useNodesByType(type: StepType): NodeDefinition[] {
  const { getNodesByType } = useNodeRegistry();
  return useMemo(() => getNodesByType(type), [getNodesByType, type]);
}

/**
 * Hook to search nodes.
 * Convenience wrapper with debouncing.
 */
export function useNodeSearch(query: string, debounceMs = 150): NodeDefinition[] {
  const { searchNodes } = useNodeRegistry();
  const [debouncedQuery, setDebouncedQuery] = useState(query);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), debounceMs);
    return () => clearTimeout(timer);
  }, [query, debounceMs]);

  return useMemo(
    () => (debouncedQuery ? searchNodes(debouncedQuery) : []),
    [searchNodes, debouncedQuery]
  );
}

/**
 * Hook to get parameter definitions for a node.
 * Only available when using JSON registry.
 */
export function useNodeParameters(type: StepType, name: string): {
  parameters: ParameterDefinition[];
  sweepable: ParameterDefinition[];
  defaults: Record<string, unknown>;
} {
  const { getNodeDefinition, getSweepableParams, getDefaultParams, isJsonRegistry } = useNodeRegistry();

  return useMemo(() => {
    if (!isJsonRegistry) {
      return { parameters: [], sweepable: [], defaults: getDefaultParams(type, name) };
    }

    const node = getNodeDefinition(type, name);
    return {
      parameters: node?.parameters ?? [],
      sweepable: getSweepableParams(type, name),
      defaults: getDefaultParams(type, name),
    };
  }, [type, name, getNodeDefinition, getSweepableParams, getDefaultParams, isJsonRegistry]);
}
