import type { CampaignPlanPreview } from "@/lib/campaignPlanPreviewTypes";
import { buildCampaignSummaryFields } from "@/lib/campaignPlanPresentation";

import { NewExperimentCampaignSummaryFields } from "./NewExperimentCampaignSummaryFields";
import { NewExperimentCampaignSummaryMetadata } from "./NewExperimentCampaignSummaryMetadata";

export interface NewExperimentCampaignPreviewSummaryProps {
  campaignPreview: CampaignPlanPreview;
}

export function NewExperimentCampaignPreviewSummary({
  campaignPreview,
}: NewExperimentCampaignPreviewSummaryProps) {
  const summaryFields = buildCampaignSummaryFields(campaignPreview);

  return (
    <>
      <NewExperimentCampaignSummaryFields fields={summaryFields} />
      <NewExperimentCampaignSummaryMetadata campaignPreview={campaignPreview} />
    </>
  );
}
