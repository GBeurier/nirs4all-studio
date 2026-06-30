import { Badge } from "@/components/ui/badge";
import type { CampaignPreviewNoticeSeverity } from "@/lib/campaignNoticeTypes";
import { getCampaignNoticeBadgeVariant } from "@/lib/campaignPlanPresentation";

export interface NewExperimentCampaignNoticeSeverityBadgeProps {
  severity: CampaignPreviewNoticeSeverity;
}

export function NewExperimentCampaignNoticeSeverityBadge({
  severity,
}: NewExperimentCampaignNoticeSeverityBadgeProps) {
  return (
    <Badge variant={getCampaignNoticeBadgeVariant(severity)}>
      {severity}
    </Badge>
  );
}
