import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  NodeRegistry,
  type CategoryConfig,
  type ParameterDefinition,
  type WebappSplitMetadata,
} from "@/data/nodes";
import type { StepType } from "../types";

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
  colorScheme?: CategoryConfig["color"];
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
  /** Fatal loading error (base registry failed - no operators available) */
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

export const NodeRegistryContext = createContext<NodeRegistryContextValue | undefined>(undefined);

export function useNodeRegistry(): NodeRegistryContextValue {
  const context = useContext(NodeRegistryContext);

  if (context === undefined) {
    throw new Error("useNodeRegistry must be used within a NodeRegistryProvider");
  }

  return context;
}

export function useNodeRegistryOptional(): NodeRegistryContextValue | undefined {
  return useContext(NodeRegistryContext);
}

export function useNodesByType(type: StepType): NodeDefinition[] {
  const { getNodesByType } = useNodeRegistry();
  return useMemo(() => getNodesByType(type), [getNodesByType, type]);
}

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
