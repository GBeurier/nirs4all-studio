import type {
  PipelineParams,
  PipelineStep,
  StepSubType,
  StepType,
} from "@/components/pipeline-editor/types";

export const EDITOR_GRAPH_DOCUMENT_VERSION = "studio.editor-graph-document.v1" as const;

export type EditorGraphDocumentVersion = typeof EDITOR_GRAPH_DOCUMENT_VERSION;
export type EditorGraphDocumentSource = "legacy-editor";
export type EditorGraphNodeKind = "operator" | "flow" | "utility";
export type EditorGraphPortDirection = "input" | "output";
export type EditorGraphPortRole = "sequence" | "children" | "branch" | "named_branch";
export type EditorGraphEdgeKind = "sequence" | "contains" | "branch" | "named_branch";
export type EditorGraphNodeRelation = "children" | "branch" | "named_branch";

export interface EditorGraphOperatorRef {
  name: string;
  classPath?: string;
  functionPath?: string;
  framework?: string;
}

export type EditorGraphLegacyStepPayload = Record<string, unknown> & {
  id: string;
  type: StepType;
  subType?: StepSubType;
  name: string;
  params: PipelineParams;
};

export interface EditorGraphNodePlacement {
  parentNodeId: string;
  relation: EditorGraphNodeRelation;
  branchIndex?: number;
  branchLabel?: string;
}

export interface EditorGraphNode {
  id: string;
  legacyStepId: string;
  kind: EditorGraphNodeKind;
  stepType: StepType;
  subType?: StepSubType;
  label: string;
  operator: EditorGraphOperatorRef;
  params: PipelineParams;
  enabled: boolean;
  placement?: EditorGraphNodePlacement;
  order: number;
  depth: number;
  path: string;
  legacyStep: EditorGraphLegacyStepPayload;
}

export interface EditorGraphPort {
  id: string;
  nodeId: string;
  direction: EditorGraphPortDirection;
  role: EditorGraphPortRole;
  order?: number;
  branchIndex?: number;
  branchLabel?: string;
  label?: string;
}

export interface EditorGraphEdge {
  id: string;
  kind: EditorGraphEdgeKind;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
  order: number;
  label?: string;
}

export interface EditorGraphDocument {
  id: string;
  name?: string;
  version: EditorGraphDocumentVersion;
  source: EditorGraphDocumentSource;
  rootNodeIds: string[];
  nodes: EditorGraphNode[];
  ports: EditorGraphPort[];
  edges: EditorGraphEdge[];
}

export interface BuildEditorGraphDocumentOptions {
  id?: string;
  name?: string;
}

export type EditorGraphPortRoleCounts = Record<EditorGraphPortRole, number>;
export type EditorGraphEdgeKindCounts = Record<EditorGraphEdgeKind, number>;

export interface EditorGraphNodeSummary {
  id: string;
  legacyStepId: string;
  kind: EditorGraphNodeKind;
  stepType: StepType;
  subType?: StepSubType;
  label: string;
  enabled: boolean;
  placement?: EditorGraphNodePlacement;
  order: number;
  depth: number;
  path: string;
  paramsFingerprint: string;
  legacyStepFingerprint: string;
}

export interface EditorGraphEdgeSummary {
  id: string;
  kind: EditorGraphEdgeKind;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
  order: number;
  label?: string;
}

export interface EditorGraphDocumentSummary {
  version: EditorGraphDocumentVersion;
  source: EditorGraphDocumentSource;
  rootNodeIds: string[];
  nodeCount: number;
  portCount: number;
  edgeCount: number;
  maxDepth: number;
  portsByRole: EditorGraphPortRoleCounts;
  edgesByKind: EditorGraphEdgeKindCounts;
  nodes: EditorGraphNodeSummary[];
  edges: EditorGraphEdgeSummary[];
}

export interface EditorGraphDocumentDifference {
  path: string;
  expected: unknown;
  actual: unknown;
}

export interface EditorGraphDocumentComparison {
  equivalent: boolean;
  differences: EditorGraphDocumentDifference[];
  legacySummary: EditorGraphDocumentSummary;
  documentSummary: EditorGraphDocumentSummary;
}

const STRUCTURAL_STEP_KEYS = new Set(["branches", "namedBranches", "children"]);
const MISSING_VALUE = "<missing>";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry)) as T;
  }

  if (isRecord(value)) {
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      copy[key] = cloneValue(entry);
    }
    return copy as T;
  }

  return value;
}

function getNodeKind(stepType: StepType, subType?: StepSubType): EditorGraphNodeKind {
  if (stepType === "flow") return "flow";
  if (stepType === "utility" || subType === "chart" || subType === "comment") return "utility";
  return "operator";
}

function makeNodeId(rawId: string, path: string, usedNodeIds: Map<string, number>): string {
  const base = rawId.trim() ? rawId : `legacy:${path}`;
  const seen = usedNodeIds.get(base) ?? 0;
  usedNodeIds.set(base, seen + 1);
  return seen === 0 ? base : `${base}#${seen + 1}`;
}

function sequenceInputPortId(nodeId: string): string {
  return `${nodeId}:in`;
}

function sequenceOutputPortId(nodeId: string): string {
  return `${nodeId}:out`;
}

function childrenPortId(nodeId: string): string {
  return `${nodeId}:children`;
}

function branchPortId(nodeId: string, branchIndex: number): string {
  return `${nodeId}:branch:${branchIndex}`;
}

function namedBranchPortId(nodeId: string, label: string, order: number): string {
  return `${nodeId}:named-branch:${encodeURIComponent(label)}:${order}`;
}

function makeEdgeId(kind: EditorGraphEdgeKind, sourcePortId: string, targetPortId: string, order: number): string {
  return `${kind}:${sourcePortId}->${targetPortId}:${order}`;
}

function getBranchLabel(step: PipelineStep, branchIndex: number): string | undefined {
  const metadataLabel = step.branchMetadata?.[branchIndex]?.name;
  return typeof metadataLabel === "string" && metadataLabel.trim() ? metadataLabel : undefined;
}

function toLegacyStepPayload(step: PipelineStep): EditorGraphLegacyStepPayload {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(step)) {
    if (!STRUCTURAL_STEP_KEYS.has(key)) {
      payload[key] = cloneValue(value);
    }
  }

  return {
    ...payload,
    id: step.id,
    type: step.type,
    ...(step.subType ? { subType: step.subType } : {}),
    name: step.name,
    params: cloneValue(step.params),
  } as EditorGraphLegacyStepPayload;
}

function stripStructuralStepFields(value: Record<string, unknown>): void {
  for (const key of STRUCTURAL_STEP_KEYS) {
    delete value[key];
  }
}

function compareGraphOrder(a: Pick<EditorGraphNode, "order" | "path" | "id">, b: Pick<EditorGraphNode, "order" | "path" | "id">): number {
  return a.order - b.order || a.path.localeCompare(b.path) || a.id.localeCompare(b.id);
}

function comparePortOrder(a: EditorGraphPort, b: EditorGraphPort): number {
  return (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id);
}

function compareEdgeOrder(
  a: Pick<EditorGraphEdge, "id" | "kind" | "order" | "sourceNodeId" | "sourcePortId" | "targetNodeId" | "targetPortId">,
  b: Pick<EditorGraphEdge, "id" | "kind" | "order" | "sourceNodeId" | "sourcePortId" | "targetNodeId" | "targetPortId">,
): number {
  return a.order - b.order
    || a.kind.localeCompare(b.kind)
    || a.sourceNodeId.localeCompare(b.sourceNodeId)
    || a.sourcePortId.localeCompare(b.sourcePortId)
    || a.targetNodeId.localeCompare(b.targetNodeId)
    || a.targetPortId.localeCompare(b.targetPortId)
    || a.id.localeCompare(b.id);
}

function toStableSerializableValue(value: unknown): unknown {
  if (value === undefined) {
    return { __editorGraphDocumentValue: "undefined" };
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    return { __editorGraphDocumentNumber: String(value) };
  }

  if (typeof value === "bigint") {
    return { __editorGraphDocumentBigInt: value.toString() };
  }

  if (typeof value === "function" || typeof value === "symbol") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toStableSerializableValue(entry));
  }

  if (isRecord(value)) {
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      copy[key] = toStableSerializableValue(value[key]);
    }
    return copy;
  }

  return value;
}

function stableFingerprint(value: unknown): string {
  return JSON.stringify(toStableSerializableValue(value));
}

function makePortRoleCounts(ports: readonly EditorGraphPort[]): EditorGraphPortRoleCounts {
  const counts: EditorGraphPortRoleCounts = {
    sequence: 0,
    children: 0,
    branch: 0,
    named_branch: 0,
  };

  for (const port of ports) {
    counts[port.role] += 1;
  }

  return counts;
}

function makeEdgeKindCounts(edges: readonly EditorGraphEdge[]): EditorGraphEdgeKindCounts {
  const counts: EditorGraphEdgeKindCounts = {
    sequence: 0,
    contains: 0,
    branch: 0,
    named_branch: 0,
  };

  for (const edge of edges) {
    counts[edge.kind] += 1;
  }

  return counts;
}

function collectValueDifferences(
  expected: unknown,
  actual: unknown,
  path: string,
  differences: EditorGraphDocumentDifference[],
): void {
  if (Object.is(expected, actual)) {
    return;
  }

  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      differences.push({ path, expected, actual });
      return;
    }

    if (expected.length !== actual.length) {
      differences.push({ path: `${path}.length`, expected: expected.length, actual: actual.length });
    }

    const comparableLength = Math.min(expected.length, actual.length);
    for (let index = 0; index < comparableLength; index += 1) {
      collectValueDifferences(expected[index], actual[index], `${path}[${index}]`, differences);
    }
    return;
  }

  if (isRecord(expected) || isRecord(actual)) {
    if (!isRecord(expected) || !isRecord(actual)) {
      differences.push({ path, expected, actual });
      return;
    }

    const keys = Array.from(new Set([...Object.keys(expected), ...Object.keys(actual)])).sort();
    for (const key of keys) {
      const hasExpectedValue = Object.prototype.hasOwnProperty.call(expected, key);
      const hasActualValue = Object.prototype.hasOwnProperty.call(actual, key);

      if (!hasExpectedValue || !hasActualValue) {
        differences.push({
          path: `${path}.${key}`,
          expected: hasExpectedValue ? expected[key] : MISSING_VALUE,
          actual: hasActualValue ? actual[key] : MISSING_VALUE,
        });
        continue;
      }

      collectValueDifferences(expected[key], actual[key], `${path}.${key}`, differences);
    }
    return;
  }

  differences.push({ path, expected, actual });
}

export function legacyStepsToEditorGraphDocument(
  steps: readonly PipelineStep[],
  options: BuildEditorGraphDocumentOptions = {},
): EditorGraphDocument {
  const nodes: EditorGraphNode[] = [];
  const ports: EditorGraphPort[] = [];
  const edges: EditorGraphEdge[] = [];
  const rootNodeIds: string[] = [];
  const usedNodeIds = new Map<string, number>();

  const addPort = (port: EditorGraphPort) => {
    ports.push(port);
    return port.id;
  };

  const addEdge = (
    kind: EditorGraphEdgeKind,
    sourceNodeId: string,
    sourcePortId: string,
    targetNodeId: string,
    targetPortId: string,
    order: number,
    label?: string,
  ) => {
    edges.push({
      id: makeEdgeId(kind, sourcePortId, targetPortId, order),
      kind,
      sourceNodeId,
      sourcePortId,
      targetNodeId,
      targetPortId,
      order,
      ...(label ? { label } : {}),
    });
  };

  const walkSequence = (
    sequence: readonly PipelineStep[],
    scopePath: string,
    depth: number,
    placement?: Omit<EditorGraphNodePlacement, "branchLabel"> & { branchLabel?: string },
  ): string[] => {
    const sequenceNodeIds: string[] = [];

    sequence.forEach((step, order) => {
      const path = `${scopePath}.${order}`;
      const nodeId = makeNodeId(step.id, path, usedNodeIds);
      const nodePlacement = placement ? { ...placement } : undefined;
      const legacyStep = toLegacyStepPayload(step);

      nodes.push({
        id: nodeId,
        legacyStepId: step.id,
        kind: getNodeKind(step.type, step.subType),
        stepType: step.type,
        ...(step.subType ? { subType: step.subType } : {}),
        label: step.name,
        operator: {
          name: step.name,
          ...(step.classPath ? { classPath: step.classPath } : {}),
          ...(step.functionPath ? { functionPath: step.functionPath } : {}),
          ...(step.framework ? { framework: step.framework } : {}),
        },
        params: cloneValue(step.params),
        enabled: step.enabled !== false,
        ...(nodePlacement ? { placement: nodePlacement } : {}),
        order,
        depth,
        path,
        legacyStep,
      });

      addPort({
        id: sequenceInputPortId(nodeId),
        nodeId,
        direction: "input",
        role: "sequence",
      });
      addPort({
        id: sequenceOutputPortId(nodeId),
        nodeId,
        direction: "output",
        role: "sequence",
      });

      sequenceNodeIds.push(nodeId);
      if (order > 0) {
        const previousNodeId = sequenceNodeIds[order - 1];
        addEdge(
          "sequence",
          previousNodeId,
          sequenceOutputPortId(previousNodeId),
          nodeId,
          sequenceInputPortId(nodeId),
          order,
        );
      }

      if (Array.isArray(step.children)) {
        const childPortId = addPort({
          id: childrenPortId(nodeId),
          nodeId,
          direction: "output",
          role: "children",
        });
        const childNodeIds = walkSequence(step.children, `${path}.children`, depth + 1, {
          parentNodeId: nodeId,
          relation: "children",
        });

        childNodeIds.forEach((childNodeId, childOrder) => {
          addEdge(
            "contains",
            nodeId,
            childPortId,
            childNodeId,
            sequenceInputPortId(childNodeId),
            childOrder,
          );
        });
      }

      if (Array.isArray(step.branches)) {
        step.branches.forEach((branchSteps, branchIndex) => {
          const branchLabel = getBranchLabel(step, branchIndex);
          const sourcePortId = addPort({
            id: branchPortId(nodeId, branchIndex),
            nodeId,
            direction: "output",
            role: "branch",
            order: branchIndex,
            branchIndex,
            ...(branchLabel ? { branchLabel, label: branchLabel } : {}),
          });
          const branchNodeIds = walkSequence(branchSteps, `${path}.branches.${branchIndex}`, depth + 1, {
            parentNodeId: nodeId,
            relation: "branch",
            branchIndex,
            ...(branchLabel ? { branchLabel } : {}),
          });

          if (branchNodeIds[0]) {
            addEdge(
              "branch",
              nodeId,
              sourcePortId,
              branchNodeIds[0],
              sequenceInputPortId(branchNodeIds[0]),
              branchIndex,
              branchLabel ?? `branch ${branchIndex + 1}`,
            );
          }
        });
      }

      if (step.namedBranches && isRecord(step.namedBranches)) {
        Object.entries(step.namedBranches).forEach(([branchLabel, branchSteps], namedBranchOrder) => {
          if (!Array.isArray(branchSteps)) return;

          const sourcePortId = addPort({
            id: namedBranchPortId(nodeId, branchLabel, namedBranchOrder),
            nodeId,
            direction: "output",
            role: "named_branch",
            order: namedBranchOrder,
            branchIndex: namedBranchOrder,
            branchLabel,
            label: branchLabel,
          });
          const branchNodeIds = walkSequence(branchSteps, `${path}.namedBranches.${branchLabel}`, depth + 1, {
            parentNodeId: nodeId,
            relation: "named_branch",
            branchIndex: namedBranchOrder,
            branchLabel,
          });

          if (branchNodeIds[0]) {
            addEdge(
              "named_branch",
              nodeId,
              sourcePortId,
              branchNodeIds[0],
              sequenceInputPortId(branchNodeIds[0]),
              namedBranchOrder,
              branchLabel,
            );
          }
        });
      }
    });

    return sequenceNodeIds;
  };

  rootNodeIds.push(...walkSequence(steps, "steps", 0));

  return {
    id: options.id ?? "legacy-editor-document",
    ...(options.name ? { name: options.name } : {}),
    version: EDITOR_GRAPH_DOCUMENT_VERSION,
    source: "legacy-editor",
    rootNodeIds,
    nodes,
    ports,
    edges,
  };
}

export function editorGraphDocumentToLegacySteps(document: EditorGraphDocument): PipelineStep[] {
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]));

  const getPortsForNode = (nodeId: string, role: EditorGraphPortRole): EditorGraphPort[] => (
    document.ports
      .filter((port) => port.nodeId === nodeId && port.role === role)
      .sort(comparePortOrder)
  );

  const getPlacedNodes = (
    parentNodeId: string,
    relation: EditorGraphNodeRelation,
    predicate: (placement: EditorGraphNodePlacement) => boolean = () => true,
  ): EditorGraphNode[] => (
    document.nodes
      .filter((node) => (
        node.placement?.parentNodeId === parentNodeId
        && node.placement.relation === relation
        && predicate(node.placement)
      ))
      .sort(compareGraphOrder)
  );

  const buildStep = (node: EditorGraphNode): PipelineStep => {
    const payload = cloneValue(node.legacyStep) as Record<string, unknown>;
    stripStructuralStepFields(payload);

    const step = {
      ...payload,
      id: typeof payload.id === "string" && payload.id.trim() ? payload.id : node.legacyStepId,
      type: (payload.type ?? node.stepType) as StepType,
      ...(node.subType && payload.subType === undefined ? { subType: node.subType } : {}),
      name: typeof payload.name === "string" && payload.name.trim() ? payload.name : node.label,
      params: isRecord(payload.params) ? cloneValue(payload.params) : cloneValue(node.params),
    } as PipelineStep;

    const childNodes = getPlacedNodes(node.id, "children");
    if (getPortsForNode(node.id, "children").length > 0 || childNodes.length > 0) {
      step.children = childNodes.map(buildStep);
    }

    const branchPorts = getPortsForNode(node.id, "branch");
    const branchIndexes = new Set<number>();
    for (const port of branchPorts) {
      if (typeof port.branchIndex === "number") branchIndexes.add(port.branchIndex);
    }
    for (const childNode of getPlacedNodes(node.id, "branch")) {
      if (typeof childNode.placement?.branchIndex === "number") {
        branchIndexes.add(childNode.placement.branchIndex);
      }
    }

    if (branchIndexes.size > 0) {
      const maxBranchIndex = Math.max(...branchIndexes);
      step.branches = Array.from({ length: maxBranchIndex + 1 }, (_, branchIndex) => (
        getPlacedNodes(node.id, "branch", (placement) => placement.branchIndex === branchIndex).map(buildStep)
      ));
    }

    const namedBranchPorts = getPortsForNode(node.id, "named_branch");
    const namedBranchLabels = new Set<string>();
    for (const port of namedBranchPorts) {
      if (port.branchLabel) namedBranchLabels.add(port.branchLabel);
    }
    for (const childNode of getPlacedNodes(node.id, "named_branch")) {
      if (childNode.placement?.branchLabel) namedBranchLabels.add(childNode.placement.branchLabel);
    }

    if (namedBranchLabels.size > 0) {
      step.namedBranches = {};
      for (const label of namedBranchLabels) {
        step.namedBranches[label] = getPlacedNodes(
          node.id,
          "named_branch",
          (placement) => placement.branchLabel === label,
        ).map(buildStep);
      }
    }

    return step;
  };

  const rootNodes = document.rootNodeIds.length > 0
    ? document.rootNodeIds.map((nodeId) => nodesById.get(nodeId)).filter((node): node is EditorGraphNode => Boolean(node))
    : document.nodes.filter((node) => !node.placement).sort(compareGraphOrder);

  return rootNodes.map(buildStep);
}

export function summarizeEditorGraphDocument(document: EditorGraphDocument): EditorGraphDocumentSummary {
  const nodes = document.nodes
    .slice()
    .sort(compareGraphOrder)
    .map((node): EditorGraphNodeSummary => ({
      id: node.id,
      legacyStepId: node.legacyStepId,
      kind: node.kind,
      stepType: node.stepType,
      ...(node.subType ? { subType: node.subType } : {}),
      label: node.label,
      enabled: node.enabled,
      ...(node.placement ? { placement: cloneValue(node.placement) } : {}),
      order: node.order,
      depth: node.depth,
      path: node.path,
      paramsFingerprint: stableFingerprint(node.params),
      legacyStepFingerprint: stableFingerprint(node.legacyStep),
    }));

  const edges = document.edges
    .slice()
    .sort(compareEdgeOrder)
    .map((edge): EditorGraphEdgeSummary => ({
      id: edge.id,
      kind: edge.kind,
      sourceNodeId: edge.sourceNodeId,
      sourcePortId: edge.sourcePortId,
      targetNodeId: edge.targetNodeId,
      targetPortId: edge.targetPortId,
      order: edge.order,
      ...(edge.label ? { label: edge.label } : {}),
    }));

  return {
    version: document.version,
    source: document.source,
    rootNodeIds: [...document.rootNodeIds],
    nodeCount: document.nodes.length,
    portCount: document.ports.length,
    edgeCount: document.edges.length,
    maxDepth: nodes.reduce((maxDepth, node) => Math.max(maxDepth, node.depth), 0),
    portsByRole: makePortRoleCounts(document.ports),
    edgesByKind: makeEdgeKindCounts(document.edges),
    nodes,
    edges,
  };
}

export function summarizeLegacySteps(steps: readonly PipelineStep[]): EditorGraphDocumentSummary {
  return summarizeEditorGraphDocument(legacyStepsToEditorGraphDocument(steps));
}

export function compareLegacyStepsToEditorGraphDocument(
  steps: readonly PipelineStep[],
  document: EditorGraphDocument,
): EditorGraphDocumentComparison {
  const legacySummary = summarizeLegacySteps(steps);
  const documentSummary = summarizeEditorGraphDocument(document);
  const differences: EditorGraphDocumentDifference[] = [];

  collectValueDifferences(legacySummary, documentSummary, "summary", differences);
  collectValueDifferences(steps, editorGraphDocumentToLegacySteps(document), "legacySteps", differences);

  return {
    equivalent: differences.length === 0,
    differences,
    legacySummary,
    documentSummary,
  };
}

export const buildEditorGraphDocumentFromLegacySteps = legacyStepsToEditorGraphDocument;
export const legacyStepsFromEditorGraphDocument = editorGraphDocumentToLegacySteps;
