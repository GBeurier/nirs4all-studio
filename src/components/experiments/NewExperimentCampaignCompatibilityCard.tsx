import type { CampaignPlanPreview } from "@/lib/campaignPlanPreviewTypes";
import { formatCampaignCompatibilityDetailLabels } from "@/lib/campaignPlanPresentation";

import { NewExperimentCampaignCompatibilityCardHeader } from "./NewExperimentCampaignCompatibilityCardHeader";
import { NewExperimentCampaignCompatibilityChecksList } from "./NewExperimentCampaignCompatibilityChecksList";
import { NewExperimentCampaignPreviewDetailLabels } from "./NewExperimentCampaignPreviewDetailLabels";
import { campaignPreviewCardClass } from "./NewExperimentCampaignPreviewPrimitives";

export type NewExperimentCampaignCompatibilityPreview =
  CampaignPlanPreview["compatibilityPreviews"][number];

export interface NewExperimentCampaignCompatibilityCardProps {
  compatibilityPreview: NewExperimentCampaignCompatibilityPreview;
}

export function NewExperimentCampaignCompatibilityCard({
  compatibilityPreview,
}: NewExperimentCampaignCompatibilityCardProps) {
  const detailLabels = formatCampaignCompatibilityDetailLabels(compatibilityPreview);

  return (
    <div className={campaignPreviewCardClass}>
      <NewExperimentCampaignCompatibilityCardHeader
        datasetLabel={compatibilityPreview.datasetLabel}
        pipelineLabel={compatibilityPreview.pipelineLabel}
        status={compatibilityPreview.status}
        statusLabel={compatibilityPreview.statusLabel}
      />
      <p className="mt-1 text-xs text-muted-foreground">{compatibilityPreview.summary}</p>
      <NewExperimentCampaignPreviewDetailLabels labels={detailLabels} />
      <NewExperimentCampaignCompatibilityChecksList checks={compatibilityPreview.checks} />
    </div>
  );
}
