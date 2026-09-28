import type { Dataset } from "@/types/datasets";

import {
  buildDatasetSchemaRef,
  type DatasetSchemaRef,
  type DatasetSchemaTaskType,
} from "./datasetSchema";
import { formatDatasetAggregationTitleLabel } from "./datasetSchemaAggregation";
import { getMultimodalDatasetSummary, type MultimodalDatasetSummary } from "./multimodalDatasetSummary";
import {
  getDatasetDefaultDataView,
  getDatasetSchemaViewCounts,
} from "./datasetSchemaAccessors";

export interface ExperimentDatasetOption {
  id: string;
  name: string;
  samples: number;
  trainSamples?: number;
  testSamples?: number;
  features: number;
  sourceCount: number | null;
  isMultiSource: boolean;
  representationCount: number;
  dataViewLabel: string;
  dataViewTaskType: DatasetSchemaTaskType;
  target: string;
  targetCount: number;
  metadataColumns: string[];
  repetitionColumn?: string;
  aggregationLabel: string | null;
  schemaRef: DatasetSchemaRef;
  raw: Dataset;
  multimodalSummary?: MultimodalDatasetSummary;
}

export function toExperimentDatasetOption(dataset: Dataset): ExperimentDatasetOption {
  const multimodalSummary = getMultimodalDatasetSummary(dataset.config?.dataset_document);
  const schemaRef = buildDatasetSchemaRef(dataset);
  const defaultDataView = getDatasetDefaultDataView(schemaRef);
  const counts = getDatasetSchemaViewCounts(schemaRef, defaultDataView);

  return {
    id: dataset.id,
    name: dataset.name || dataset.path?.split(/[\\/]/).filter(Boolean).pop() || "Unknown",
    samples: multimodalSummary?.samples ?? counts.sampleCount ?? 0,
    trainSamples: dataset.train_samples,
    testSamples: dataset.test_samples,
    features: counts.featureCount ?? 0,
    sourceCount: counts.sourceCount,
    isMultiSource: schemaRef.isMultiSource,
    representationCount: schemaRef.representations.length,
    dataViewLabel: multimodalSummary ? "Typed multimodal cohort" : defaultDataView?.label ?? "Unknown data view",
    dataViewTaskType: multimodalSummary?.task === "regression" || multimodalSummary?.task === "classification"
      ? multimodalSummary.task : defaultDataView?.taskType ?? schemaRef.taskType,
    target: multimodalSummary?.targets[0] || schemaRef.defaultTargetColumn || "Unknown",
    targetCount: multimodalSummary?.targets.length ?? schemaRef.targetColumns.length,
    metadataColumns: schemaRef.metadataColumns,
    repetitionColumn: schemaRef.repetitionColumn ?? undefined,
    aggregationLabel: formatDatasetAggregationTitleLabel(schemaRef.aggregation),
    schemaRef,
    raw: dataset,
    multimodalSummary: multimodalSummary ?? undefined,
  };
}
