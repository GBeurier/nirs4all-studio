import {
  campaignPlanHiddenLabels,
  campaignPlanSectionTitles,
} from "@/lib/campaignPlanPresentation";

import { NewExperimentCampaignPreviewSection } from "./NewExperimentCampaignPreviewPrimitives";
import {
  NewExperimentCampaignSinglePairSplitCandidateCard,
} from "./NewExperimentCampaignSinglePairSplitCandidateCard";
import {
  NewExperimentCampaignSinglePairSplitStatusCard,
  type NewExperimentCampaignSinglePairSplitPreview,
} from "./NewExperimentCampaignSinglePairSplitStatusCard";

export function NewExperimentCampaignSinglePairSplitSection({
  singlePairSplitPreview,
}: {
  singlePairSplitPreview: NewExperimentCampaignSinglePairSplitPreview;
}) {
  if (
    singlePairSplitPreview.status !== "split_recommended" &&
    singlePairSplitPreview.candidatePreviews.length === 0 &&
    singlePairSplitPreview.hiddenCandidateCount <= 0
  ) {
    return null;
  }

  return (
    <NewExperimentCampaignPreviewSection
      title={campaignPlanSectionTitles.singlePairSplits}
      hiddenCount={singlePairSplitPreview.hiddenCandidateCount}
      hiddenLabel={campaignPlanHiddenLabels.singlePairSplits}
    >
      <NewExperimentCampaignSinglePairSplitStatusCard
        singlePairSplitPreview={singlePairSplitPreview}
      />
      {singlePairSplitPreview.candidatePreviews.map((candidatePreview) => (
        <NewExperimentCampaignSinglePairSplitCandidateCard
          key={candidatePreview.id}
          candidatePreview={candidatePreview}
        />
      ))}
    </NewExperimentCampaignPreviewSection>
  );
}
