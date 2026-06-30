import { campaignSinglePairSplitTagLabel } from "@/lib/campaignPlanPresentation";

import { campaignPreviewTagClass } from "./NewExperimentCampaignPreviewPrimitives";

export interface NewExperimentCampaignSinglePairSplitStatusHeaderProps {
  statusLabel: string;
}

export function NewExperimentCampaignSinglePairSplitStatusHeader({
  statusLabel,
}: NewExperimentCampaignSinglePairSplitStatusHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <span className="font-medium text-foreground">{statusLabel}</span>
      <span className={campaignPreviewTagClass}>{campaignSinglePairSplitTagLabel}</span>
    </div>
  );
}
