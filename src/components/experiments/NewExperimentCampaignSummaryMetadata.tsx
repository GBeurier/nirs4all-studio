import type { CampaignPlanPreview } from "@/lib/campaignPlanPreviewTypes";
import {
  formatCampaignExecutionAdapterLine,
  formatCampaignSchemaConstraintLine,
} from "@/lib/campaignPlanPresentation";

export interface NewExperimentCampaignSummaryMetadataProps {
  campaignPreview: CampaignPlanPreview;
}

export function NewExperimentCampaignSummaryMetadata({
  campaignPreview,
}: NewExperimentCampaignSummaryMetadataProps) {
  return (
    <>
      <p className="text-xs text-muted-foreground">
        {formatCampaignSchemaConstraintLine(campaignPreview)}
      </p>
      <p className="text-xs text-muted-foreground">
        {formatCampaignExecutionAdapterLine(campaignPreview)}
      </p>
    </>
  );
}
