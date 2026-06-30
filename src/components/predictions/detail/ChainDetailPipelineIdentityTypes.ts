export const CV_PARTITIONS = ["val", "test", "train"] as const;

export type CvPartition = (typeof CV_PARTITIONS)[number];

export interface PipelineIdentityStats {
  operators: number;
  models: number;
  branches: number;
  variants: number;
  hasGenerators: boolean;
}

export interface PipelineIdentityTreeNode {
  id: string;
  label: string;
  depth: number;
  kind: "step" | "branch" | "model";
  params: Array<[string, unknown]>;
  hasGenerator: boolean;
}

export interface PipelineIdentityTree {
  nodes: PipelineIdentityTreeNode[];
  total: number;
}

export interface CvMetricRow {
  metric: string;
  values: Record<CvPartition, number | null>;
}

export interface ChainDetailPipelineIdentityProps {
  title: string;
  modelClass: string | null;
  pipelineName: string | null;
  pipelineStats: PipelineIdentityStats | null;
  pipelineTree: PipelineIdentityTree | null;
  variantParams: Record<string, unknown> | null;
  bestParams: Record<string, unknown> | null;
  branchPathLabel: string | null;
  generatorChoiceCount: number;
  additionalCvMetricRows: CvMetricRow[];
  cvFoldCount: number;
}
