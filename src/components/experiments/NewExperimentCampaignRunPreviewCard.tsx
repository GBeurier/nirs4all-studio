import type { CampaignPlanPreview } from "@/lib/campaignPlanPreviewTypes";
import {
  formatCampaignGroupByTag,
  formatCampaignRunDetailLabels,
} from "@/lib/campaignPlanPresentation";

import { campaignPreviewCardClass } from "./NewExperimentCampaignPreviewPrimitives";
import { NewExperimentCampaignPreviewDetailLabels } from "./NewExperimentCampaignPreviewDetailLabels";
import { NewExperimentCampaignRunPreviewHeader } from "./NewExperimentCampaignRunPreviewHeader";

export type NewExperimentCampaignRunPreview =
  CampaignPlanPreview["runPreviews"][number];

export interface NewExperimentCampaignRunPreviewCardProps {
  runPreview: NewExperimentCampaignRunPreview;
}

export function NewExperimentCampaignRunPreviewCard({
  runPreview,
}: NewExperimentCampaignRunPreviewCardProps) {
  const groupByTag = formatCampaignGroupByTag(runPreview.splitGroupBy);
  const detailLabels = formatCampaignRunDetailLabels(runPreview);

  return (
    <div className={campaignPreviewCardClass}>
      <NewExperimentCampaignRunPreviewHeader
        compatibilityStatus={runPreview.compatibilityStatus}
        compatibilityStatusLabel={runPreview.compatibilityStatusLabel}
        datasetLabel={runPreview.datasetLabel}
        groupByTag={groupByTag}
        pipelineLabel={runPreview.pipelineLabel}
        positionLabel={runPreview.positionLabel}
      />
      {runPreview.compatibilitySummary && (
        <p className="mt-1 text-xs text-muted-foreground">{runPreview.compatibilitySummary}</p>
      )}
      <NewExperimentCampaignPreviewDetailLabels labels={detailLabels} />
    </div>
  );
}
