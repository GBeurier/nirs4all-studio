import {
  clientStorageKeys,
  createClientStoragePersistenceStorage,
} from "./clientStorage";
import type { PipelineStep } from "@/components/pipeline-editor/types";
import {
  EDITOR_GRAPH_DOCUMENT_VERSION,
  legacyStepsToEditorGraphDocument,
  type EditorGraphDocument,
} from "./editorGraphDocument";
import type { CurrentEditedPipeline } from "./experimentPipelineSelection";

export const CURRENT_EDITED_PIPELINE_STORAGE_KEY = clientStorageKeys.currentEditedPipeline.key;

export interface CurrentEditedPipelineHandoff extends CurrentEditedPipeline {
  timestamp: number;
}

export interface BuildCurrentEditedPipelineHandoffInput {
  pipelineId: string;
  isNew: boolean;
  name: string;
  steps: unknown[];
  isDirty: boolean;
  now?: () => number;
}

export interface ExperimentRouteForPipelineInput {
  pipelineId: string;
  isNew: boolean;
  isDirty: boolean;
}

type PipelineHandoffStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const currentEditedPipelineHandoffStorage = createClientStoragePersistenceStorage(
  clientStorageKeys.currentEditedPipeline,
);

export function buildCurrentEditedPipelineHandoff({
  pipelineId,
  isNew,
  name,
  steps,
  isDirty,
  now = Date.now,
}: BuildCurrentEditedPipelineHandoffInput): CurrentEditedPipelineHandoff {
  const editorGraphDocument = buildEditorGraphDocumentForHandoff({
    pipelineId,
    name,
    steps,
  });

  return {
    id: isNew ? undefined : pipelineId,
    name,
    steps,
    ...(editorGraphDocument ? { editorGraphDocument } : {}),
    isDirty,
    timestamp: now(),
  };
}

export function getExperimentRouteForPipeline({
  pipelineId,
  isNew,
  isDirty,
}: ExperimentRouteForPipelineInput): string {
  if (!isNew && !isDirty) {
    return `/editor?pipeline=${encodeURIComponent(pipelineId)}`;
  }
  return "/editor?source=editor";
}

export function storeCurrentEditedPipelineHandoff(
  storage: PipelineHandoffStorage,
  handoff: CurrentEditedPipelineHandoff,
): void {
  storage.setItem(CURRENT_EDITED_PIPELINE_STORAGE_KEY, JSON.stringify(handoff));
}

export function storeCurrentEditedPipelineHandoffInClientStorage(
  handoff: CurrentEditedPipelineHandoff,
): void {
  storeCurrentEditedPipelineHandoff(currentEditedPipelineHandoffStorage, handoff);
}

export function parseCurrentEditedPipelineHandoff(
  raw: string | null,
): CurrentEditedPipeline | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;

    const { id, name, steps, isDirty } = parsed;
    if (id !== undefined && typeof id !== "string") return null;
    if (typeof name !== "string" || name.trim().length === 0) return null;
    if (!Array.isArray(steps)) return null;
    if (typeof isDirty !== "boolean") return null;

    const editorGraphDocument = isEditorGraphDocument(parsed.editorGraphDocument)
      ? parsed.editorGraphDocument
      : undefined;

    return {
      id,
      name,
      steps,
      ...(editorGraphDocument ? { editorGraphDocument } : {}),
      isDirty,
    };
  } catch {
    return null;
  }
}

export function consumeCurrentEditedPipelineHandoff(
  storage: PipelineHandoffStorage,
): CurrentEditedPipeline | null {
  const raw = storage.getItem(CURRENT_EDITED_PIPELINE_STORAGE_KEY);
  const parsed = parseCurrentEditedPipelineHandoff(raw);
  if (raw != null) {
    storage.removeItem(CURRENT_EDITED_PIPELINE_STORAGE_KEY);
  }
  return parsed;
}

export function consumeCurrentEditedPipelineHandoffFromClientStorage(): CurrentEditedPipeline | null {
  return consumeCurrentEditedPipelineHandoff(currentEditedPipelineHandoffStorage);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildEditorGraphDocumentForHandoff({
  pipelineId,
  name,
  steps,
}: {
  pipelineId: string;
  name: string;
  steps: unknown[];
}): EditorGraphDocument | undefined {
  if (!isPipelineStepArray(steps)) return undefined;

  return legacyStepsToEditorGraphDocument(steps, {
    id: pipelineId,
    name,
  });
}

function isPipelineStepArray(value: unknown): value is PipelineStep[] {
  return Array.isArray(value) && value.every(isPipelineStep);
}

function isPipelineStep(value: unknown): value is PipelineStep {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.type !== "string") return false;
  if (typeof value.name !== "string") return false;
  if (!isRecord(value.params)) return false;

  if (value.children !== undefined && !isPipelineStepArray(value.children)) return false;
  if (
    value.branches !== undefined
    && (!Array.isArray(value.branches) || !value.branches.every(isPipelineStepArray))
  ) {
    return false;
  }
  if (value.namedBranches !== undefined) {
    if (!isRecord(value.namedBranches)) return false;
    if (!Object.values(value.namedBranches).every(isPipelineStepArray)) return false;
  }

  return true;
}

function isEditorGraphDocument(value: unknown): value is EditorGraphDocument {
  if (!isRecord(value)) return false;
  if (value.version !== EDITOR_GRAPH_DOCUMENT_VERSION) return false;
  if (value.source !== "legacy-editor") return false;
  if (typeof value.id !== "string") return false;
  if (value.name !== undefined && typeof value.name !== "string") return false;
  if (!isStringArray(value.rootNodeIds)) return false;
  if (!Array.isArray(value.nodes) || !value.nodes.every(isEditorGraphNode)) return false;
  if (!Array.isArray(value.ports) || !value.ports.every(isEditorGraphPort)) return false;
  if (!Array.isArray(value.edges) || !value.edges.every(isEditorGraphEdge)) return false;

  return true;
}

function isEditorGraphNode(value: unknown): value is EditorGraphDocument["nodes"][number] {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.legacyStepId !== "string") return false;
  if (!isOneOf(value.kind, ["operator", "flow", "utility"])) return false;
  if (typeof value.stepType !== "string") return false;
  if (value.subType !== undefined && typeof value.subType !== "string") return false;
  if (typeof value.label !== "string") return false;
  if (!isRecord(value.operator) || typeof value.operator.name !== "string") return false;
  if (!isRecord(value.params)) return false;
  if (typeof value.enabled !== "boolean") return false;
  if (value.placement !== undefined && !isEditorGraphPlacement(value.placement)) return false;
  if (typeof value.order !== "number") return false;
  if (typeof value.depth !== "number") return false;
  if (typeof value.path !== "string") return false;
  if (!isPipelineStep(value.legacyStep)) return false;

  return true;
}

function isEditorGraphPlacement(value: unknown): value is EditorGraphDocument["nodes"][number]["placement"] {
  if (!isRecord(value)) return false;
  if (typeof value.parentNodeId !== "string") return false;
  if (!isOneOf(value.relation, ["children", "branch", "named_branch"])) return false;
  if (value.branchIndex !== undefined && typeof value.branchIndex !== "number") return false;
  if (value.branchLabel !== undefined && typeof value.branchLabel !== "string") return false;

  return true;
}

function isEditorGraphPort(value: unknown): value is EditorGraphDocument["ports"][number] {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.nodeId !== "string") return false;
  if (!isOneOf(value.direction, ["input", "output"])) return false;
  if (!isOneOf(value.role, ["sequence", "children", "branch", "named_branch"])) return false;
  if (value.order !== undefined && typeof value.order !== "number") return false;
  if (value.branchIndex !== undefined && typeof value.branchIndex !== "number") return false;
  if (value.branchLabel !== undefined && typeof value.branchLabel !== "string") return false;
  if (value.label !== undefined && typeof value.label !== "string") return false;

  return true;
}

function isEditorGraphEdge(value: unknown): value is EditorGraphDocument["edges"][number] {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (!isOneOf(value.kind, ["sequence", "contains", "branch", "named_branch"])) return false;
  if (typeof value.sourceNodeId !== "string") return false;
  if (typeof value.sourcePortId !== "string") return false;
  if (typeof value.targetNodeId !== "string") return false;
  if (typeof value.targetPortId !== "string") return false;
  if (typeof value.order !== "number") return false;
  if (value.label !== undefined && typeof value.label !== "string") return false;

  return true;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isOneOf<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === "string" && choices.includes(value as T);
}
