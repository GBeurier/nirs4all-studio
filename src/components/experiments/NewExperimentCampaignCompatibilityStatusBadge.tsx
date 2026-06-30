import { Badge } from "@/components/ui/badge";
import type { DatasetPipelineCompatibilityStatus } from "@/lib/campaignCompatibilityTypes";
import { getCampaignCompatibilityBadgeVariant } from "@/lib/campaignPlanPresentation";

export interface NewExperimentCampaignCompatibilityStatusBadgeProps {
  label: string;
  status: DatasetPipelineCompatibilityStatus;
}

export function NewExperimentCampaignCompatibilityStatusBadge({
  label,
  status,
}: NewExperimentCampaignCompatibilityStatusBadgeProps) {
  return (
    <Badge variant={getCampaignCompatibilityBadgeVariant(status)}>
      {label}
    </Badge>
  );
}
