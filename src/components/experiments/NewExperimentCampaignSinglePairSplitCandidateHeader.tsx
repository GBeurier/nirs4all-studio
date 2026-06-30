import { formatCampaignPairLabel } from "@/lib/campaignPlanPresentation";

import { campaignPreviewTagClass } from "./NewExperimentCampaignPreviewPrimitives";

export interface NewExperimentCampaignSinglePairSplitCandidateHeaderProps {
  datasetLabel: string;
  groupByTag: string | null;
  pipelineLabel: string;
  positionLabel: string;
}

export function NewExperimentCampaignSinglePairSplitCandidateHeader({
  datasetLabel,
  groupByTag,
  pipelineLabel,
  positionLabel,
}: NewExperimentCampaignSinglePairSplitCandidateHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <span className="mr-2 font-medium text-foreground">{positionLabel}</span>
        <span className="break-words text-muted-foreground">
          {formatCampaignPairLabel(datasetLabel, pipelineLabel)}
        </span>
      </div>
      {groupByTag && (
        <span className={campaignPreviewTagClass}>{groupByTag}</span>
      )}
    </div>
  );
}
