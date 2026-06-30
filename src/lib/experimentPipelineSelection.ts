import type { PipelineInfo, PipelineStep } from "@/api/pipelines";

import { buildCampaignPipelineProjection } from "./campaignPipelineAdapter";
import {
  EDITOR_GRAPH_DOCUMENT_VERSION,
  editorGraphDocumentToLegacySteps,
  type EditorGraphDocument,
} from "./editorGraphDocument";
import { buildPipelineComplexityPreview } from "./pipelineComplexityPreview";

export const CURRENT_EDITED_PIPELINE_ID = "__current_edited__";

export interface CurrentEditedPipeline {
  id?: string;
  name: string;
  steps: unknown[];
  editorGraphDocument?: EditorGraphDocument;
  isDirty: boolean;
}

export interface ExperimentPipelineOption {
  id: string;
  name: string;
  preset: boolean;
  favorite: boolean;
  steps: string;
  nodeCount: number;
  activeNodeCount: number;
  disabledNodeCount: number;
  branchCount: number;
  generatorCount: number;
  stepGeneratorCount: number;
  parameterSweepCount: number;
  finetuneNodeCount: number;
  refitNodeCount: number;
  maxDepth: number;
  isCurrentEdited?: true;
}

export interface SelectedPipelineConfig {
  id: string;
  name: string;
  steps: unknown[];
}

function buildExperimentPipelineGraphFields(
  id: string,
  name: string,
  steps: readonly unknown[],
): Pick<
  ExperimentPipelineOption,
  | "steps"
  | "nodeCount"
  | "activeNodeCount"
  | "disabledNodeCount"
  | "branchCount"
  | "generatorCount"
  | "stepGeneratorCount"
  | "parameterSweepCount"
  | "finetuneNodeCount"
  | "refitNodeCount"
  | "maxDepth"
> {
  const projection = buildCampaignPipelineProjection({ id, name, steps: [...steps] });
  const complexity = buildPipelineComplexityPreview(projection.graph);
  return {
    steps: projection.stepSummary,
    nodeCount: projection.graphSummary.nodeCount,
    activeNodeCount: projection.graphSummary.activeNodeCount,
    disabledNodeCount: projection.graphSummary.disabledNodeCount,
    branchCount: projection.graphSummary.branchCount,
    generatorCount: projection.graphSummary.generatorCount,
    stepGeneratorCount: complexity.stepGeneratorCount ?? 0,
    parameterSweepCount: complexity.parameterSweepCount ?? 0,
    finetuneNodeCount: complexity.finetuneNodeCount ?? 0,
    refitNodeCount: complexity.refitNodeCount ?? 0,
    maxDepth: projection.graphSummary.maxDepth,
  };
}

export function summarizePipelineSteps(steps: PipelineInfo["steps"]): string {
  return buildExperimentPipelineGraphFields("pipeline-preview", "Pipeline preview", steps).steps;
}

export function toExperimentPipelineOption(pipeline: PipelineInfo): ExperimentPipelineOption {
  const graphFields = buildExperimentPipelineGraphFields(pipeline.id, pipeline.name, pipeline.steps);

  return {
    id: pipeline.id,
    name: pipeline.name,
    preset: pipeline.category === "preset",
    favorite: pipeline.is_favorite || false,
    ...graphFields,
  };
}

export function buildAllPipelineOptions(
  currentEditedPipeline: CurrentEditedPipeline | null,
  savedPipelines: ExperimentPipelineOption[],
): ExperimentPipelineOption[] {
  if (!currentEditedPipeline) return savedPipelines;
  const currentEditedSteps = getCurrentEditedPipelineSteps(currentEditedPipeline);
  const graphFields = buildExperimentPipelineGraphFields(
    CURRENT_EDITED_PIPELINE_ID,
    currentEditedPipeline.name,
    currentEditedSteps,
  );

  return [
    {
      id: CURRENT_EDITED_PIPELINE_ID,
      name: `[Current] ${currentEditedPipeline.name}${currentEditedPipeline.isDirty ? " (unsaved)" : ""}`,
      preset: false,
      favorite: false,
      ...graphFields,
      isCurrentEdited: true,
    },
    ...savedPipelines,
  ];
}

export function getSelectedPipelineConfigs(
  rawPipelines: PipelineInfo[],
  selectedPipelineIds: string[],
  currentEditedPipeline: CurrentEditedPipeline | null,
): SelectedPipelineConfig[] {
  const selected = rawPipelines
    .filter((pipeline) => selectedPipelineIds.includes(pipeline.id))
    .map((pipeline) => ({
      id: pipeline.id,
      name: pipeline.name,
      steps: pipeline.steps as PipelineStep[] as unknown[],
    }));

  if (selectedPipelineIds.includes(CURRENT_EDITED_PIPELINE_ID) && currentEditedPipeline) {
    selected.unshift({
      id: CURRENT_EDITED_PIPELINE_ID,
      name: currentEditedPipeline.name,
      steps: getCurrentEditedPipelineSteps(currentEditedPipeline),
    });
  }

  return selected;
}

function getCurrentEditedPipelineSteps(currentEditedPipeline: CurrentEditedPipeline): unknown[] {
  const { editorGraphDocument } = currentEditedPipeline;
  if (!isEditorGraphDocument(editorGraphDocument)) return currentEditedPipeline.steps;

  try {
    return editorGraphDocumentToLegacySteps(editorGraphDocument);
  } catch {
    return currentEditedPipeline.steps;
  }
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
  if (!isLegacyStepPayload(value.legacyStep)) return false;

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

function isLegacyStepPayload(value: unknown): value is EditorGraphDocument["nodes"][number]["legacyStep"] {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.type !== "string") return false;
  if (typeof value.name !== "string") return false;
  if (!isRecord(value.params)) return false;

  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isOneOf<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === "string" && choices.includes(value as T);
}
