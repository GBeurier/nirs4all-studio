export type DatasetPipelineCompatibilityStatus =
  | "not_evaluated"
  | "passed"
  | "warning"
  | "blocking";

export interface DatasetPipelineCompatibilityCheck {
  id: string;
  status: DatasetPipelineCompatibilityStatus;
  title: string;
  message: string;
}

export interface DatasetPipelineCompatibilityPreview {
  id: string;
  datasetId: string;
  pipelineId: string;
  datasetLabel: string;
  pipelineLabel: string;
  status: DatasetPipelineCompatibilityStatus;
  statusLabel: string;
  summary: string;
  dataViewLabel: string;
  dataViewTaskLabel: string;
  targetLabel: string;
  targetCountLabel: string;
  sourceCountLabel: string;
  sourceModeLabel: string;
  datasetAggregationLabel: string;
  datasetAggregationSourceLabel: string | null;
  pipelineNodeCountLabel: string;
  transformationSizeLabel: string;
  pipelineComplexityLabels: string[];
  checks: DatasetPipelineCompatibilityCheck[];
}
