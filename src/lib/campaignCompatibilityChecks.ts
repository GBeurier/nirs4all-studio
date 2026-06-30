import type {
  CampaignDatasetRef,
  CampaignPipelineRef,
} from "./campaignSpecTypes";
import type {
  DataViewRef,
} from "./datasetSchema";
import type {
  DatasetPipelineCompatibilityCheck,
  DatasetPipelineCompatibilityStatus,
} from "./campaignCompatibilityTypes";
import { getDatasetAggregationReadiness } from "./datasetSchemaAggregation";

export function formatCompatibilityCount(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function formatOptionalCompatibilityCount(
  count: number | null | undefined,
  singular: string,
  plural = `${singular}s`,
): string {
  if (typeof count !== "number") return `Unknown ${plural}`;
  return formatCompatibilityCount(count, singular, plural);
}

export function getDatasetPipelineCompatibilityStatusLabel(
  status: DatasetPipelineCompatibilityStatus,
): string {
  if (status === "passed") return "Ready";
  if (status === "warning") return "Warning";
  if (status === "blocking") return "Blocking";
  return "Not evaluated";
}

export function getDatasetPipelineCompatibilityPreviewStatus(
  checks: DatasetPipelineCompatibilityCheck[],
): DatasetPipelineCompatibilityStatus {
  if (checks.some((check) => check.status === "blocking")) return "blocking";
  if (checks.some((check) => check.status === "warning")) return "warning";
  if (checks.some((check) => check.status === "not_evaluated")) return "not_evaluated";
  return "passed";
}

export function getDatasetPipelineCompatibilityPreviewSummary(
  status: DatasetPipelineCompatibilityStatus,
): string {
  if (status === "passed") {
    return "Schema preview ready for this dataset/pipeline pair.";
  }
  if (status === "warning") {
    return "Schema preview is available but has warnings for stricter execution modes.";
  }
  if (status === "blocking") {
    return "Campaign data is inconsistent and cannot be previewed safely.";
  }
  return "Compatibility preview needs both a dataset schema ref and a pipeline graph spec.";
}

function countActiveRefitNodes(
  graph: CampaignPipelineRef["graph"],
): number {
  return graph?.nodes.filter((node) => node.enabled && node.hasRefit).length ?? 0;
}

export function buildDatasetPipelineCompatibilityChecks({
  dataset,
  pipeline,
  defaultDataView,
}: {
  dataset?: CampaignDatasetRef;
  pipeline?: CampaignPipelineRef;
  defaultDataView?: DataViewRef;
}): DatasetPipelineCompatibilityCheck[] {
  const schemaRef = dataset?.schemaRef;
  const graph = pipeline?.graph;
  const checks: DatasetPipelineCompatibilityCheck[] = [];

  if (!dataset) {
    checks.push({
      id: "dataset-ref",
      status: "blocking",
      title: "Dataset ref",
      message: "The run matrix references a dataset that is not present in the campaign.",
    });
  } else if (!schemaRef) {
    checks.push({
      id: "dataset-schema-ref",
      status: "not_evaluated",
      title: "Dataset schema ref",
      message: "No dataset schema ref is attached to this campaign dataset.",
    });
  } else {
    checks.push({
      id: "dataset-schema-ref",
      status: "passed",
      title: "Dataset schema ref",
      message: `Dataset schema ${schemaRef.fingerprint} is available.`,
    });
  }

  if (!pipeline) {
    checks.push({
      id: "pipeline-ref",
      status: "blocking",
      title: "Pipeline ref",
      message: "The run matrix references a pipeline that is not present in the campaign.",
    });
  } else if (!graph) {
    checks.push({
      id: "pipeline-graph-spec",
      status: "not_evaluated",
      title: "Pipeline graph spec",
      message: "No pipeline graph spec is attached to this campaign pipeline.",
    });
  } else {
    checks.push({
      id: "pipeline-graph-spec",
      status: "passed",
      title: "Pipeline graph spec",
      message: `Pipeline graph ${graph.version} is available.`,
    });
  }

  if (schemaRef && graph) {
    checks.push({
      id: "data-view",
      status: defaultDataView && defaultDataView.representationIds.length > 0
        ? "passed"
        : "warning",
      title: "Default data view",
      message: defaultDataView && defaultDataView.representationIds.length > 0
        ? `Default data view "${defaultDataView.label}" exposes ${formatCompatibilityCount(defaultDataView.representationIds.length, "representation")}.`
        : "No usable default data view is available for this dataset.",
    });
    checks.push({
      id: "feature-axis",
      status: schemaRef.featureCount != null && schemaRef.featureCount > 0
        ? "passed"
        : "warning",
      title: "Feature axis",
      message: schemaRef.featureCount != null && schemaRef.featureCount > 0
        ? `Dataset exposes ${formatCompatibilityCount(schemaRef.featureCount, "feature")}.`
        : "Dataset feature count is unknown or empty.",
    });
    checks.push({
      id: "target",
      status: schemaRef.defaultTargetColumn ? "passed" : "warning",
      title: "Default target",
      message: schemaRef.defaultTargetColumn
        ? `Default target is "${schemaRef.defaultTargetColumn}".`
        : "No default target is declared for this dataset.",
    });
    const aggregationReadiness = getDatasetAggregationReadiness(schemaRef.aggregation);
    checks.push({
      id: "dataset-aggregation",
      status: aggregationReadiness.status === "warning" ? "warning" : "passed",
      title: "Dataset aggregation",
      message: aggregationReadiness.message,
    });
    const refitNodeCount = countActiveRefitNodes(graph);
    if (schemaRef.aggregation.enabled && refitNodeCount > 0) {
      const refitNodeCountLabel = formatCompatibilityCount(refitNodeCount, "refit node");
      const aggregationReady = aggregationReadiness.status !== "warning";
      checks.push({
        id: "refit-aggregation",
        status: aggregationReady ? "passed" : "warning",
        title: "Refit aggregation",
        message: aggregationReady
          ? `${refitNodeCountLabel} will refit on aggregated dataset rows. ${aggregationReadiness.message}`
          : `${refitNodeCountLabel} may refit with aggregation metadata that is not strict-mode ready. ${aggregationReadiness.message}`,
      });
    }
    checks.push({
      id: "pipeline-active-nodes",
      status: graph.stats.activeNodeCount > 0 ? "passed" : "warning",
      title: "Pipeline active nodes",
      message: graph.stats.activeNodeCount > 0
        ? `Pipeline exposes ${formatCompatibilityCount(graph.stats.activeNodeCount, "active node")}.`
        : "Pipeline graph has no active nodes.",
    });
  }

  return checks;
}
