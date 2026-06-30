import type { CampaignPlanPreview } from "@/lib/campaignPlanPreviewTypes";
import { formatCampaignPipelineDetailLabels } from "@/lib/campaignPlanPresentation";

import { NewExperimentCampaignInputPreviewCardShell } from "./NewExperimentCampaignInputPreviewCardShell";

export type NewExperimentCampaignPipelinePreview =
  CampaignPlanPreview["pipelinePreviews"][number];

export interface NewExperimentCampaignPipelinePreviewCardProps {
  pipelinePreview: NewExperimentCampaignPipelinePreview;
}

export function NewExperimentCampaignPipelinePreviewCard({
  pipelinePreview,
}: NewExperimentCampaignPipelinePreviewCardProps) {
  const detailLabels = formatCampaignPipelineDetailLabels(pipelinePreview);

  return (
    <NewExperimentCampaignInputPreviewCardShell
      detailLabels={detailLabels}
      tagLabel={pipelinePreview.sourceLabel}
      title={pipelinePreview.label}
    />
  );
}
