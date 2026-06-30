import {
  campaignPreviewCardClass,
  campaignPreviewTagClass,
} from "./NewExperimentCampaignPreviewPrimitives";
import { NewExperimentCampaignPreviewDetailLabels } from "./NewExperimentCampaignPreviewDetailLabels";

export interface NewExperimentCampaignInputPreviewCardShellProps {
  detailLabels: string[];
  tagLabel: string | null;
  title: string;
}

export function NewExperimentCampaignInputPreviewCardShell({
  detailLabels,
  tagLabel,
  title,
}: NewExperimentCampaignInputPreviewCardShellProps) {
  return (
    <div className={campaignPreviewCardClass}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="font-medium text-foreground">{title}</span>
        {tagLabel && <span className={campaignPreviewTagClass}>{tagLabel}</span>}
      </div>
      <NewExperimentCampaignPreviewDetailLabels labels={detailLabels} />
    </div>
  );
}
