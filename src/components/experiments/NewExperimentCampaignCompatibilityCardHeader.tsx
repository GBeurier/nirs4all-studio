import type { CampaignPlanPreview } from "@/lib/campaignPlanPreviewTypes";
import { formatCampaignPairLabel } from "@/lib/campaignPlanPresentation";
import { NewExperimentCampaignCompatibilityStatusBadge } from "./NewExperimentCampaignCompatibilityStatusBadge";

export type NewExperimentCampaignCompatibilityStatus =
  CampaignPlanPreview["compatibilityPreviews"][number]["status"];

export interface NewExperimentCampaignCompatibilityCardHeaderProps {
  datasetLabel: string;
  pipelineLabel: string;
  status: NewExperimentCampaignCompatibilityStatus;
  statusLabel: string;
}

export function NewExperimentCampaignCompatibilityCardHeader({
  datasetLabel,
  pipelineLabel,
  status,
  statusLabel,
}: NewExperimentCampaignCompatibilityCardHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <span className="font-medium text-foreground">
        {formatCampaignPairLabel(datasetLabel, pipelineLabel)}
      </span>
      <NewExperimentCampaignCompatibilityStatusBadge
        label={statusLabel}
        status={status}
      />
    </div>
  );
}
