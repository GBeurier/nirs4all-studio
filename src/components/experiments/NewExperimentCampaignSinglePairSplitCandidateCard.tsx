import type { CampaignPlanPreview } from "@/lib/campaignPlanPreviewTypes";
import {
  formatCampaignSinglePairSplitCandidateDetailLabels,
  formatCampaignGroupByTag,
} from "@/lib/campaignPlanPresentation";

import { campaignPreviewCardClass } from "./NewExperimentCampaignPreviewPrimitives";
import { NewExperimentCampaignPreviewDetailLabels } from "./NewExperimentCampaignPreviewDetailLabels";
import { NewExperimentCampaignSinglePairSplitCandidateHeader } from "./NewExperimentCampaignSinglePairSplitCandidateHeader";

export type NewExperimentCampaignSinglePairSplitCandidatePreview =
  CampaignPlanPreview["singlePairSplitPreview"]["candidatePreviews"][number];

export interface NewExperimentCampaignSinglePairSplitCandidateCardProps {
  candidatePreview: NewExperimentCampaignSinglePairSplitCandidatePreview;
}

export function NewExperimentCampaignSinglePairSplitCandidateCard({
  candidatePreview,
}: NewExperimentCampaignSinglePairSplitCandidateCardProps) {
  const groupByTag = formatCampaignGroupByTag(candidatePreview.splitGroupBy);
  const detailLabels = formatCampaignSinglePairSplitCandidateDetailLabels(candidatePreview);

  return (
    <div className={campaignPreviewCardClass}>
      <NewExperimentCampaignSinglePairSplitCandidateHeader
        datasetLabel={candidatePreview.datasetLabel}
        groupByTag={groupByTag}
        pipelineLabel={candidatePreview.pipelineLabel}
        positionLabel={candidatePreview.positionLabel}
      />
      <p className="mt-1 text-xs text-muted-foreground">{candidatePreview.suggestedCampaignName}</p>
      <NewExperimentCampaignPreviewDetailLabels labels={detailLabels} />
    </div>
  );
}
