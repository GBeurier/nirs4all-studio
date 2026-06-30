import type {
  CampaignPlanSummary,
  CampaignSpec,
} from "./campaignSpecTypes";
import type { CampaignPreviewNotice } from "./campaignNoticeTypes";
import {
  buildCampaignSchemaConstraintPreview,
  type CampaignSchemaConstraintPreview,
} from "./campaignSchemaConstraints";

export function buildCampaignPreviewNotices(
  campaign: CampaignSpec,
  summary: CampaignPlanSummary,
  executionBackendLabel: string,
  schemaConstraintPreview: CampaignSchemaConstraintPreview = buildCampaignSchemaConstraintPreview(campaign, summary),
): CampaignPreviewNotice[] {
  const notices: CampaignPreviewNotice[] = [];

  if (summary.datasetCount === 0) {
    notices.push({
      id: "missing-datasets",
      severity: "blocking",
      title: "No dataset selected",
      message: "Select at least one dataset before launching this campaign.",
    });
  }

  if (summary.pipelineCount === 0) {
    notices.push({
      id: "missing-pipelines",
      severity: "blocking",
      title: "No pipeline selected",
      message: "Select at least one pipeline before launching this campaign.",
    });
  }

  if (schemaConstraintPreview.notice) notices.push(schemaConstraintPreview.notice);

  if (campaign.mode === "paired_by_index" && summary.datasetCount !== summary.pipelineCount) {
    notices.push({
      id: "paired-count-mismatch",
      severity: "blocking",
      title: "Unpaired campaign inputs",
      message: "Paired campaigns require the same number of datasets and pipelines before launch.",
    });
  }

  if (campaign.executionBackend !== "local-python") {
    notices.push({
      id: "nonlocal-backend",
      severity: "warning",
      title: `${executionBackendLabel} backend`,
      message: "This frontend contract can describe the backend, but the current launch adapter still targets the legacy local run API.",
    });
  }

  return notices;
}
