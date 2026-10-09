import i18n from "i18next";

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
import { formatCampaignPreviewCount } from "./campaignDatasetSchemaLabels";
import { getDatasetAggregationReadiness } from "./datasetSchemaAggregation";

export function getDatasetPipelineCompatibilityStatusLabel(
  status: DatasetPipelineCompatibilityStatus,
): string {
  if (status === "passed") return i18n.t("newExperiment.campaign.status.ready");
  if (status === "warning") return i18n.t("newExperiment.campaign.status.warning");
  if (status === "blocking") return i18n.t("newExperiment.campaign.status.blocking");
  return i18n.t("newExperiment.campaign.status.notEvaluated");
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
    return i18n.t("newExperiment.campaign.compat.summary.passed");
  }
  if (status === "warning") {
    return i18n.t("newExperiment.campaign.compat.summary.warning");
  }
  if (status === "blocking") {
    return i18n.t("newExperiment.campaign.compat.summary.blocking");
  }
  return i18n.t("newExperiment.campaign.compat.summary.notEvaluated");
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
      title: i18n.t("newExperiment.campaign.compat.datasetRef.title"),
      message: i18n.t("newExperiment.campaign.compat.datasetRef.missing"),
    });
  } else if (!schemaRef) {
    checks.push({
      id: "dataset-schema-ref",
      status: "not_evaluated",
      title: i18n.t("newExperiment.campaign.compat.datasetSchemaRef.title"),
      message: i18n.t("newExperiment.campaign.compat.datasetSchemaRef.missing"),
    });
  } else {
    checks.push({
      id: "dataset-schema-ref",
      status: "passed",
      title: i18n.t("newExperiment.campaign.compat.datasetSchemaRef.title"),
      message: i18n.t("newExperiment.campaign.compat.datasetSchemaRef.available", { fingerprint: schemaRef.fingerprint }),
    });
  }

  if (!pipeline) {
    checks.push({
      id: "pipeline-ref",
      status: "blocking",
      title: i18n.t("newExperiment.campaign.compat.pipelineRef.title"),
      message: i18n.t("newExperiment.campaign.compat.pipelineRef.missing"),
    });
  } else if (!graph) {
    checks.push({
      id: "pipeline-graph-spec",
      status: "not_evaluated",
      title: i18n.t("newExperiment.campaign.compat.pipelineGraphSpec.title"),
      message: i18n.t("newExperiment.campaign.compat.pipelineGraphSpec.missing"),
    });
  } else {
    checks.push({
      id: "pipeline-graph-spec",
      status: "passed",
      title: i18n.t("newExperiment.campaign.compat.pipelineGraphSpec.title"),
      message: i18n.t("newExperiment.campaign.compat.pipelineGraphSpec.available", { version: graph.version }),
    });
  }

  if (schemaRef && graph) {
    checks.push({
      id: "data-view",
      status: defaultDataView && defaultDataView.representationIds.length > 0
        ? "passed"
        : "warning",
      title: i18n.t("newExperiment.campaign.compat.dataView.title"),
      message: defaultDataView && defaultDataView.representationIds.length > 0
        ? i18n.t("newExperiment.campaign.compat.dataView.ok", {
          label: defaultDataView.label,
          representations: formatCampaignPreviewCount(defaultDataView.representationIds.length, "representation"),
        })
        : i18n.t("newExperiment.campaign.compat.dataView.missing"),
    });
    checks.push({
      id: "feature-axis",
      status: schemaRef.featureCount != null && schemaRef.featureCount > 0
        ? "passed"
        : "warning",
      title: i18n.t("newExperiment.campaign.compat.featureAxis.title"),
      message: schemaRef.featureCount != null && schemaRef.featureCount > 0
        ? i18n.t("newExperiment.campaign.compat.featureAxis.ok", {
          features: formatCampaignPreviewCount(schemaRef.featureCount, "feature"),
        })
        : i18n.t("newExperiment.campaign.compat.featureAxis.missing"),
    });
    checks.push({
      id: "target",
      status: schemaRef.defaultTargetColumn ? "passed" : "warning",
      title: i18n.t("newExperiment.campaign.compat.target.title"),
      message: schemaRef.defaultTargetColumn
        ? i18n.t("newExperiment.campaign.compat.target.ok", { target: schemaRef.defaultTargetColumn })
        : i18n.t("newExperiment.campaign.compat.target.missing"),
    });
    const aggregationReadiness = getDatasetAggregationReadiness(schemaRef.aggregation);
    checks.push({
      id: "dataset-aggregation",
      status: aggregationReadiness.status === "warning" ? "warning" : "passed",
      title: i18n.t("newExperiment.campaign.compat.aggregation.title"),
      message: aggregationReadiness.message,
    });
    const refitNodeCount = countActiveRefitNodes(graph);
    if (schemaRef.aggregation.enabled && refitNodeCount > 0) {
      const refitNodeCountLabel = formatCampaignPreviewCount(refitNodeCount, "refitNode");
      const aggregationReady = aggregationReadiness.status !== "warning";
      checks.push({
        id: "refit-aggregation",
        status: aggregationReady ? "passed" : "warning",
        title: i18n.t("newExperiment.campaign.compat.refitAggregation.title"),
        message: i18n.t(
          aggregationReady
            ? "newExperiment.campaign.compat.refitAggregation.ready"
            : "newExperiment.campaign.compat.refitAggregation.warning",
          { count: refitNodeCount, nodes: refitNodeCountLabel, detail: aggregationReadiness.message },
        ),
      });
    }
    checks.push({
      id: "pipeline-active-nodes",
      status: graph.stats.activeNodeCount > 0 ? "passed" : "warning",
      title: i18n.t("newExperiment.campaign.compat.activeNodes.title"),
      message: graph.stats.activeNodeCount > 0
        ? i18n.t("newExperiment.campaign.compat.activeNodes.ok", {
          nodes: formatCampaignPreviewCount(graph.stats.activeNodeCount, "activeNode"),
        })
        : i18n.t("newExperiment.campaign.compat.activeNodes.missing"),
    });
  }

  return checks;
}
