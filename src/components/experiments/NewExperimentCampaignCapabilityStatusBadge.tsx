import { Badge } from "@/components/ui/badge";
import type { CampaignCapabilityCheckStatus } from "@/lib/campaignCapabilityTypes";
import { getCampaignCapabilityBadgeVariant } from "@/lib/campaignPlanPresentation";

export interface NewExperimentCampaignCapabilityStatusBadgeProps {
  label: string;
  status: CampaignCapabilityCheckStatus;
}

export function NewExperimentCampaignCapabilityStatusBadge({
  label,
  status,
}: NewExperimentCampaignCapabilityStatusBadgeProps) {
  return (
    <Badge variant={getCampaignCapabilityBadgeVariant(status)}>
      {label}
    </Badge>
  );
}
