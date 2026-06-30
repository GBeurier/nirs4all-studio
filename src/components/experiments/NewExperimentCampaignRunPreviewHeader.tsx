import type { DatasetPipelineCompatibilityStatus } from "@/lib/campaignCompatibilityTypes";
import { formatCampaignPairLabel } from "@/lib/campaignPlanPresentation";

import { NewExperimentCampaignCompatibilityStatusBadge } from "./NewExperimentCampaignCompatibilityStatusBadge";
import { campaignPreviewTagClass } from "./NewExperimentCampaignPreviewPrimitives";

export interface NewExperimentCampaignRunPreviewHeaderProps {
  compatibilityStatus: DatasetPipelineCompatibilityStatus | null;
  compatibilityStatusLabel: string | null;
  datasetLabel: string;
  groupByTag: string | null;
  pipelineLabel: string;
  positionLabel: string;
}

export function NewExperimentCampaignRunPreviewHeader({
  compatibilityStatus,
  compatibilityStatusLabel,
  datasetLabel,
  groupByTag,
  pipelineLabel,
  positionLabel,
}: NewExperimentCampaignRunPreviewHeaderProps) {
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
      {compatibilityStatus && compatibilityStatusLabel && (
        <NewExperimentCampaignCompatibilityStatusBadge
          label={compatibilityStatusLabel}
          status={compatibilityStatus}
        />
      )}
    </div>
  );
}
