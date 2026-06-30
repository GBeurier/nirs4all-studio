import { getDatasetPipelineCompatibilityStatusLabel } from "@/lib/campaignCompatibilityChecks";
import type { CampaignPlanPreview } from "@/lib/campaignPlanPreviewTypes";
import { NewExperimentCampaignCompatibilityStatusBadge } from "./NewExperimentCampaignCompatibilityStatusBadge";

export type NewExperimentCampaignCompatibilityCheck =
  CampaignPlanPreview["compatibilityPreviews"][number]["checks"][number];

export interface NewExperimentCampaignCompatibilityCheckRowProps {
  check: NewExperimentCampaignCompatibilityCheck;
}

export function NewExperimentCampaignCompatibilityCheckRow({
  check,
}: NewExperimentCampaignCompatibilityCheckRowProps) {
  return (
    <div className="flex flex-wrap items-start gap-x-2 gap-y-1 border-t border-border/40 pt-1">
      <span className="font-medium text-foreground">{check.title}</span>
      <NewExperimentCampaignCompatibilityStatusBadge
        label={getDatasetPipelineCompatibilityStatusLabel(check.status)}
        status={check.status}
      />
      <span className="basis-full text-muted-foreground">{check.message}</span>
    </div>
  );
}
