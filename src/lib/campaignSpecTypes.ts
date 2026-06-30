import type { DatasetSchemaRef } from "./datasetSchema";
import type { PipelineGraphSpec } from "./pipelineGraphSpec";

export type CampaignExecutionBackend = "local-python" | "cluster" | "wasm-local";
export type CampaignPlanMode = "legacy_cartesian" | "paired_by_index";

export interface CampaignDatasetSchemaSummary {
  sampleCount: number | null;
  featureCount: number | null;
  targetLabel: string | null;
  metadataColumnCount: number | null;
  repetitionColumn: string | null;
}

export interface CampaignDatasetRef {
  id: string;
  name?: string;
  schema?: CampaignDatasetSchemaSummary;
  schemaRef?: DatasetSchemaRef;
  splitGroupBy: string | null;
}

export type CampaignPipelineSource = "saved" | "inline" | "inline-pruned";

export interface CampaignPipelineRef {
  id: string;
  name: string;
  source: CampaignPipelineSource;
  steps?: unknown[];
  stepCount?: number | null;
  stepSummary?: string | null;
  graph?: PipelineGraphSpec;
}

export interface CampaignRunPlanEntry {
  id: string;
  datasetId: string;
  pipelineId: string;
  datasetIndex: number;
  pipelineIndex: number;
  splitGroupBy: string | null;
}

export interface CampaignSpec {
  name: string;
  description?: string;
  mode: CampaignPlanMode;
  executionBackend: CampaignExecutionBackend;
  datasets: CampaignDatasetRef[];
  pipelines: CampaignPipelineRef[];
  runMatrix: CampaignRunPlanEntry[];
}

export interface CampaignPlanSummary {
  mode: CampaignPlanMode;
  executionBackend: CampaignExecutionBackend;
  datasetCount: number;
  pipelineCount: number;
  runCount: number;
  matrixCapacity: number;
  datasetCountLabel: string;
  pipelineCountLabel: string;
  runCountLabel: string;
  inputCardinalityLabel: string;
  matrixCapacityLabel: string;
  matrixCoverageLabel: string;
  launchSummary: string;
}

export interface BuildLegacyCampaignSpecInput {
  name: string;
  description?: string;
  selectedDatasetIds: string[];
  datasetLabelsById?: Record<string, string | undefined>;
  datasetSchemasById?: Record<string, CampaignDatasetSchemaSummary | undefined>;
  datasetSchemaRefsById?: Record<string, DatasetSchemaRef | undefined>;
  selectedPipelines: CampaignPipelineRef[];
  selectedGroupingPayload: Record<string, string | null>;
  executionBackend?: CampaignExecutionBackend;
}
