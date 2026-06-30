import type { CampaignPlanPreview } from "@/lib/campaignPlanPreviewTypes";
import { buildCampaignCapabilityCardData } from "@/lib/campaignPlanPresentation";

import { NewExperimentCampaignCapabilityCardHeader } from "./NewExperimentCampaignCapabilityCardHeader";
import { campaignPreviewCardClass } from "./NewExperimentCampaignPreviewPrimitives";

export type NewExperimentCampaignCapabilityCheck =
  CampaignPlanPreview["capabilityChecks"][number];

export interface NewExperimentCampaignCapabilityCardProps {
  check: NewExperimentCampaignCapabilityCheck;
}

export function NewExperimentCampaignCapabilityCard({
  check,
}: NewExperimentCampaignCapabilityCardProps) {
  const cardData = buildCampaignCapabilityCardData(check);

  return (
    <div className={campaignPreviewCardClass}>
      <NewExperimentCampaignCapabilityCardHeader
        status={cardData.status}
        statusLabel={cardData.statusLabel}
        title={cardData.title}
      />
      <p className="mt-1 text-xs text-muted-foreground">{cardData.message}</p>
    </div>
  );
}
