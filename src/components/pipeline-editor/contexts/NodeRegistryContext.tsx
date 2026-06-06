/**
 * NodeRegistryContext - Context for node definitions
 *
 * Provides a React context for accessing node definitions from the JSON-based
 * registry.
 *
 * @see docs/_internals/node_specifications.md
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
import { type StepType } from "../types";
import { usePipelineEditorPreferencesOptional } from "./PipelineEditorPreferencesContext";

// Import from the new node registry system
import {
  NodeRegistry,
  createNodeRegistry,
  CustomNodeStorage,
  mergeNodeDefinitions,
  type NodeDefinition as JsonNodeDefinition,
  type ParameterDefinition,
  type NodeType,
  type CategoryConfig,
  type WebappSplitMetadata,
} from "@/data/nodes";

const MAX_EXTENDED_REGISTRY_RETRIES = 5;
const EXTENDED_REGISTRY_RETRY_BASE_MS = 1000;
const EXTENDED_REGISTRY_RETRY_MAX_MS = 10000;

// ============================================================================
// Types
// ============================================================================

/**
 * Node definition interface used throughout the pipeline editor.
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
  /** Parameter definitions */
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
  /** Default parameter values (legacy support) */
  defaultParams?: Record<string, unknown>;
  /** Number of default branches for container/generator nodes */
  defaultBranches?: number;
  /** Generator kind (for generator nodes) */
  generatorKind?: "or" | "cartesian";
  /** Visibility tier for UI filtering */
  tier?: "core" | "standard" | "advanced";
  /** Splitter-specific runtime metadata for group handling */
  _webapp_split?: WebappSplitMetadata;
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
  /** Fatal loading error (base registry failed — no operators available) */
  error: Error | null;
  /** Non-fatal error loading extended registry (base operators still available) */
  extendedError: Error | null;
  /** Registry version info */
  version: {
    registry: string;
    nirs4all?: string;
  };
  /** Underlying NodeRegistry instance */
  registry: NodeRegistry | null;
}

// ============================================================================
// Context
// ============================================================================

const NodeRegistryContext = createContext<NodeRegistryContextValue | undefined>(undefined);

// ============================================================================
// Conversion
// ============================================================================

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
    tier: node.tier,
    _webapp_split: node._webapp_split,
  };
}

// ============================================================================
// Provider Props
// ============================================================================

export interface NodeRegistryProviderProps {
  children: ReactNode;
}

// ============================================================================
// Provider Component
// ============================================================================

/**
 * Provider component for node registry context.
 */
export function NodeRegistryProvider({ children }: NodeRegistryProviderProps) {
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
  const [extendedRetryToken, setExtendedRetryToken] = useState(0);

  // Ref to track if a fetch is in progress (avoids stale closure issues)
  const isFetchingExtendedRef = useRef(false);
  const extendedRetryAttempts = useRef(0);

  // If the user disables Extended mode, drop the cached extended registry.
  // This lets users toggle off/on to re-fetch after regenerating extended.json
  // while the app is running.
  useEffect(() => {
    if (extendedMode) return;
    setExtendedNodes(null);
    setExtendedError(null);
    extendedRetryAttempts.current = 0;
  }, [extendedMode]);

  // Initialize base registry and subscribe to custom node updates.
  useEffect(() => {
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
  }, []);

  // Lazy-load extended registry when Extended mode is enabled.
  useEffect(() => {
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

        extendedRetryAttempts.current = 0;
        setExtendedNodes(data as JsonNodeDefinition[]);
      } catch (e) {
        if (abort.signal.aborted) return;
        const err = e instanceof Error ? e : new Error("Failed to load extended registry");
        extendedRetryAttempts.current += 1;
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
  }, [extendedMode, extendedNodes, extendedRetryToken]);

  useEffect(() => {
    if (!extendedMode) return;
    if (extendedNodes !== null) return;
    if (!extendedError) return;
    if (extendedRetryAttempts.current >= MAX_EXTENDED_REGISTRY_RETRIES) return;

    const delayMs = Math.min(
      EXTENDED_REGISTRY_RETRY_BASE_MS * 2 ** Math.max(0, extendedRetryAttempts.current - 1),
      EXTENDED_REGISTRY_RETRY_MAX_MS,
    );
    const timeoutId = window.setTimeout(() => {
      setExtendedRetryToken((current) => current + 1);
    }, delayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [extendedMode, extendedNodes, extendedError]);

  // Build the merged registry whenever base/custom/extended nodes change.
  useEffect(() => {
    const baseRegistry = baseRegistryRef.current;
    if (!baseRegistry) return;

    const preferredNodes: JsonNodeDefinition[] = [
      ...baseRegistry.getAll(),
      ...customNodes,
    ];

    // Extended registry is append-only, but curated/custom nodes win when an
    // operator already exists under another ID or class-path alias.
    const mergedNodes = extendedMode
      ? mergeNodeDefinitions(preferredNodes, extendedNodes ?? [])
      : preferredNodes;

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
  }, [customNodes, extendedMode, extendedNodes]);

  const value = useMemo<NodeRegistryContextValue>(() => {
    if (registry) {
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
        error: error ?? null,
        extendedError: extendedMode ? extendedError : null,
        version: {
          registry: registry.version,
        },
        registry,
      };
    }

    // Registry not yet built — expose empty accessors until it loads.
    return {
      getNodesByType: () => [],
      getNodeDefinition: () => undefined,
      getNodeById: () => undefined,
      getNodeByClassPath: () => undefined,
      getNodeTypes: () => [],
      resolveClassPath: () => undefined,
      resolveNameFromClassPath: () => undefined,
      searchNodes: () => [],
      getDefaultParams: () => ({}),
      getParameterDef: () => undefined,
      getSweepableParams: () => [],
      getCategoryConfig: () => undefined,
      isLoading: isLoading || isLoadingExtended,
      error: error ?? null,
      extendedError: extendedMode ? extendedError : null,
      version: {
        registry: "loading",
      },
      registry: null,
    };
  }, [
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
 */
export function useNodeParameters(type: StepType, name: string): {
  parameters: ParameterDefinition[];
  sweepable: ParameterDefinition[];
  defaults: Record<string, unknown>;
} {
  const { getNodeDefinition, getSweepableParams, getDefaultParams } = useNodeRegistry();

  return useMemo(() => {
    const node = getNodeDefinition(type, name);
    return {
      parameters: node?.parameters ?? [],
      sweepable: getSweepableParams(type, name),
      defaults: getDefaultParams(type, name),
    };
  }, [type, name, getNodeDefinition, getSweepableParams, getDefaultParams]);
}
