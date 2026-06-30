import type { CampaignPlanPreview } from "@/lib/campaignPlanPreviewTypes";

import { campaignPreviewCardClass } from "./NewExperimentCampaignPreviewPrimitives";
import { NewExperimentCampaignSinglePairSplitStatusHeader } from "./NewExperimentCampaignSinglePairSplitStatusHeader";

export type NewExperimentCampaignSinglePairSplitPreview =
  CampaignPlanPreview["singlePairSplitPreview"];

export interface NewExperimentCampaignSinglePairSplitStatusCardProps {
  singlePairSplitPreview: NewExperimentCampaignSinglePairSplitPreview;
}

export function NewExperimentCampaignSinglePairSplitStatusCard({
  singlePairSplitPreview,
}: NewExperimentCampaignSinglePairSplitStatusCardProps) {
  return (
    <div className={campaignPreviewCardClass}>
      <NewExperimentCampaignSinglePairSplitStatusHeader
        statusLabel={singlePairSplitPreview.statusLabel}
      />
      <p className="mt-1 text-xs text-muted-foreground">{singlePairSplitPreview.summary}</p>
    </div>
  );
}
