import i18n from "i18next";

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
      title: i18n.t("newExperiment.campaign.notices.missingDatasets.title"),
      message: i18n.t("newExperiment.campaign.notices.missingDatasets.message"),
    });
  }

  if (summary.pipelineCount === 0) {
    notices.push({
      id: "missing-pipelines",
      severity: "blocking",
      title: i18n.t("newExperiment.campaign.notices.missingPipelines.title"),
      message: i18n.t("newExperiment.campaign.notices.missingPipelines.message"),
    });
  }

  if (schemaConstraintPreview.notice) notices.push(schemaConstraintPreview.notice);

  if (campaign.mode === "paired_by_index" && summary.datasetCount !== summary.pipelineCount) {
    notices.push({
      id: "paired-count-mismatch",
      severity: "blocking",
      title: i18n.t("newExperiment.campaign.notices.unpaired.title"),
      message: i18n.t("newExperiment.campaign.notices.unpaired.message"),
    });
  }

  if (campaign.executionBackend !== "local-python") {
    notices.push({
      id: "nonlocal-backend",
      severity: "warning",
      title: i18n.t("newExperiment.campaign.notices.nonLocalBackend.title", { backend: executionBackendLabel }),
      message: i18n.t("newExperiment.campaign.notices.nonLocalBackend.message"),
    });
  }

  return notices;
}
