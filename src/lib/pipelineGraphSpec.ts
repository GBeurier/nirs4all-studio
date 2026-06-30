export const PIPELINE_GRAPH_SPEC_VERSION = "studio.pipeline-graph.v1" as const;

export type PipelineGraphSpecVersion = typeof PIPELINE_GRAPH_SPEC_VERSION;
export type PipelineGraphSource = "legacy-editor";
export type PipelineGraphNodeKind = "operator" | "flow" | "utility";
export type PipelineGraphEdgeKind = "sequence" | "contains" | "branch" | "named_branch";

export interface PipelineGraphOperatorRef {
  name: string;
  classPath?: string;
  functionPath?: string;
  framework?: string;
}

export interface PipelineGraphNode {
  id: string;
  legacyStepId?: string;
  label: string;
  kind: PipelineGraphNodeKind;
  stepType?: string;
  subType?: string;
  operator: PipelineGraphOperatorRef;
  params: Record<string, unknown>;
  enabled: boolean;
  parentNodeId?: string;
  branchIndex?: number;
  branchLabel?: string;
  order: number;
  depth: number;
  path: string;
  generatorKind?: string;
  hasParameterSweeps: boolean;
  hasStepGenerator: boolean;
  hasFinetune: boolean;
  hasRefit: boolean;
  isNoOp: boolean;
}

export interface PipelineGraphEdge {
  id: string;
  kind: PipelineGraphEdgeKind;
  sourceNodeId: string;
  targetNodeId: string;
  order: number;
  label?: string;
}

export interface PipelineGraphStats {
  nodeCount: number;
  activeNodeCount: number;
  disabledNodeCount: number;
  topLevelNodeCount: number;
  branchCount: number;
  generatorCount: number;
  maxDepth: number;
}

export interface PipelineGraphSpec {
  id: string;
  name?: string;
  version: PipelineGraphSpecVersion;
  source: PipelineGraphSource;
  entryNodeIds: string[];
  nodes: PipelineGraphNode[];
  edges: PipelineGraphEdge[];
  stats: PipelineGraphStats;
}

export interface PipelineGraphSummary {
  nodeCount: number;
  activeNodeCount: number;
  disabledNodeCount: number;
  topLevelNodeCount: number;
  branchCount: number;
  generatorCount: number;
  maxDepth: number;
  stepSummary: string;
}

export interface BuildPipelineGraphSpecOptions {
  id?: string;
  name?: string;
}

type LegacyStepRecord = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function getStepArray(value: unknown): LegacyStepRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function getBranchArrays(value: unknown): LegacyStepRecord[][] {
  if (!Array.isArray(value)) return [];
  return value.map(getStepArray).filter((steps) => steps.length > 0);
}

function getNamedBranchEntries(value: unknown): Array<[string, LegacyStepRecord[]]> {
  if (!isRecord(value)) return [];
  return Object.entries(value)
    .map(([label, steps]) => [label, getStepArray(steps)] as [string, LegacyStepRecord[]])
    .filter(([, steps]) => steps.length > 0);
}

function getNodeKind(stepType?: string, subType?: string): PipelineGraphNodeKind {
  if (stepType === "flow") return "flow";
  if (stepType === "utility" || subType === "comment" || subType === "chart") return "utility";
  return "operator";
}

function makeNodeId(rawId: string | undefined, path: string, usedNodeIds: Map<string, number>): string {
  const base = rawId ?? `legacy:${path}`;
  const seen = usedNodeIds.get(base) ?? 0;
  usedNodeIds.set(base, seen + 1);
  return seen === 0 ? base : `${base}#${seen + 1}`;
}

function makeEdgeId(kind: PipelineGraphEdgeKind, sourceNodeId: string, targetNodeId: string, order: number): string {
  return `${kind}:${sourceNodeId}->${targetNodeId}:${order}`;
}

function getLegacyStepLabel(step: LegacyStepRecord): string {
  return getString(step.name) ?? getString(step.type) ?? getString(step.id) ?? "Unnamed step";
}

function countBranchGroups(step: LegacyStepRecord): number {
  return getBranchArrays(step.branches).length + getNamedBranchEntries(step.namedBranches).length;
}

export function buildPipelineGraphSpecFromLegacySteps(
  steps: unknown[],
  options: BuildPipelineGraphSpecOptions = {},
): PipelineGraphSpec {
  const nodes: PipelineGraphNode[] = [];
  const edges: PipelineGraphEdge[] = [];
  const entryNodeIds: string[] = [];
  const usedNodeIds = new Map<string, number>();
  let branchCount = 0;
  let generatorCount = 0;
  let maxDepth = 0;

  const addEdge = (
    kind: PipelineGraphEdgeKind,
    sourceNodeId: string,
    targetNodeId: string,
    order: number,
    label?: string,
  ) => {
    edges.push({
      id: makeEdgeId(kind, sourceNodeId, targetNodeId, order),
      kind,
      sourceNodeId,
      targetNodeId,
      order,
      ...(label ? { label } : {}),
    });
  };

  const walkSequence = (
    sequence: LegacyStepRecord[],
    scopePath: string,
    depth: number,
    parentNodeId?: string,
    branchIndex?: number,
    branchLabel?: string,
  ): string[] => {
    const sequenceNodeIds: string[] = [];

    sequence.forEach((step, order) => {
      const stepPath = `${scopePath}.${order}`;
      const legacyStepId = getString(step.id);
      const nodeId = makeNodeId(legacyStepId, stepPath, usedNodeIds);
      const stepType = getString(step.type);
      const subType = getString(step.subType);
      const generatorKind = getString(step.generatorKind);
      const node: PipelineGraphNode = {
        id: nodeId,
        ...(legacyStepId ? { legacyStepId } : {}),
        label: getLegacyStepLabel(step),
        kind: getNodeKind(stepType, subType),
        ...(stepType ? { stepType } : {}),
        ...(subType ? { subType } : {}),
        operator: {
          name: getLegacyStepLabel(step),
          ...(getString(step.classPath) ? { classPath: getString(step.classPath) } : {}),
          ...(getString(step.functionPath) ? { functionPath: getString(step.functionPath) } : {}),
          ...(getString(step.framework) ? { framework: getString(step.framework) } : {}),
        },
        params: getRecord(step.params),
        enabled: step.enabled !== false,
        ...(parentNodeId ? { parentNodeId } : {}),
        ...(typeof branchIndex === "number" ? { branchIndex } : {}),
        ...(branchLabel ? { branchLabel } : {}),
        order,
        depth,
        path: stepPath,
        ...(generatorKind ? { generatorKind } : {}),
        hasParameterSweeps: isRecord(step.paramSweeps) && Object.keys(step.paramSweeps).length > 0,
        hasStepGenerator: isRecord(step.stepGenerator),
        hasFinetune: isRecord(step.finetuneConfig) && step.finetuneConfig.enabled === true,
        hasRefit: isRecord(step.refitConfig) && step.refitConfig.enabled === true,
        isNoOp: step.isNoOp === true,
      };

      nodes.push(node);
      sequenceNodeIds.push(nodeId);
      maxDepth = Math.max(maxDepth, depth);
      branchCount += countBranchGroups(step);
      if (generatorKind || node.hasStepGenerator) generatorCount += 1;

      if (order > 0) {
        addEdge("sequence", sequenceNodeIds[order - 1], nodeId, order);
      }

      const children = getStepArray(step.children);
      if (children.length > 0) {
        const childNodeIds = walkSequence(children, `${stepPath}.children`, depth + 1, nodeId);
        childNodeIds.forEach((childNodeId, childOrder) => {
          addEdge("contains", nodeId, childNodeId, childOrder);
        });
      }

      getBranchArrays(step.branches).forEach((branchSteps, index) => {
        const branchNodeIds = walkSequence(
          branchSteps,
          `${stepPath}.branches.${index}`,
          depth + 1,
          nodeId,
          index,
        );
        if (branchNodeIds[0]) {
          addEdge("branch", nodeId, branchNodeIds[0], index, `branch ${index + 1}`);
        }
      });

      getNamedBranchEntries(step.namedBranches).forEach(([label, branchSteps], index) => {
        const branchNodeIds = walkSequence(
          branchSteps,
          `${stepPath}.namedBranches.${label}`,
          depth + 1,
          nodeId,
          index,
          label,
        );
        if (branchNodeIds[0]) {
          addEdge("named_branch", nodeId, branchNodeIds[0], index, label);
        }
      });
    });

    return sequenceNodeIds;
  };

  const topLevelNodeIds = walkSequence(getStepArray(steps), "steps", 0);
  entryNodeIds.push(...topLevelNodeIds);

  const disabledNodeCount = nodes.filter((node) => !node.enabled).length;

  return {
    id: options.id ?? "legacy-editor-pipeline",
    ...(options.name ? { name: options.name } : {}),
    version: PIPELINE_GRAPH_SPEC_VERSION,
    source: "legacy-editor",
    entryNodeIds,
    nodes,
    edges,
    stats: {
      nodeCount: nodes.length,
      activeNodeCount: nodes.length - disabledNodeCount,
      disabledNodeCount,
      topLevelNodeCount: topLevelNodeIds.length,
      branchCount,
      generatorCount,
      maxDepth,
    },
  };
}

export function summarizePipelineGraphSpec(graph: PipelineGraphSpec): PipelineGraphSummary {
  const topLevelNodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const topLevelLabels = graph.entryNodeIds
    .map((nodeId) => topLevelNodeById.get(nodeId))
    .filter((node): node is PipelineGraphNode => Boolean(node))
    .map((node) => node.label);

  return {
    nodeCount: graph.stats.nodeCount,
    activeNodeCount: graph.stats.activeNodeCount,
    disabledNodeCount: graph.stats.disabledNodeCount,
    topLevelNodeCount: graph.stats.topLevelNodeCount,
    branchCount: graph.stats.branchCount,
    generatorCount: graph.stats.generatorCount,
    maxDepth: graph.stats.maxDepth,
    stepSummary: topLevelLabels.length ? topLevelLabels.join(" \u2192 ") : "Empty pipeline",
  };
}
