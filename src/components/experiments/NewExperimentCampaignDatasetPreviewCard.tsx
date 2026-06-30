import type { CampaignPlanPreview } from "@/lib/campaignPlanPreviewTypes";
import {
  formatCampaignDatasetDetailLabels,
  formatCampaignGroupByTag,
} from "@/lib/campaignPlanPresentation";

import { NewExperimentCampaignInputPreviewCardShell } from "./NewExperimentCampaignInputPreviewCardShell";

export type NewExperimentCampaignDatasetPreview =
  CampaignPlanPreview["datasetPreviews"][number];

export interface NewExperimentCampaignDatasetPreviewCardProps {
  datasetPreview: NewExperimentCampaignDatasetPreview;
}

export function NewExperimentCampaignDatasetPreviewCard({
  datasetPreview,
}: NewExperimentCampaignDatasetPreviewCardProps) {
  const groupByTag = formatCampaignGroupByTag(datasetPreview.splitGroupBy);
  const detailLabels = formatCampaignDatasetDetailLabels(datasetPreview);

  return (
    <NewExperimentCampaignInputPreviewCardShell
      detailLabels={detailLabels}
      tagLabel={groupByTag}
      title={datasetPreview.label}
    />
  );
}
