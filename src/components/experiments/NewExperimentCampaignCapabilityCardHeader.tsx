import type { CampaignCapabilityCheckStatus } from "@/lib/campaignCapabilityTypes";
import { NewExperimentCampaignCapabilityStatusBadge } from "./NewExperimentCampaignCapabilityStatusBadge";

export interface NewExperimentCampaignCapabilityCardHeaderProps {
  status: CampaignCapabilityCheckStatus;
  statusLabel: string;
  title: string;
}

export function NewExperimentCampaignCapabilityCardHeader({
  status,
  statusLabel,
  title,
}: NewExperimentCampaignCapabilityCardHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <span className="font-medium text-foreground">{title}</span>
      <NewExperimentCampaignCapabilityStatusBadge
        label={statusLabel}
        status={status}
      />
    </div>
  );
}
