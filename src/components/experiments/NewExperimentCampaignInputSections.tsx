import {
  campaignPlanHiddenLabels,
  campaignPlanSectionTitles,
} from "@/lib/campaignPlanPresentation";

import {
  NewExperimentCampaignDatasetPreviewCard,
  type NewExperimentCampaignDatasetPreview,
} from "./NewExperimentCampaignDatasetPreviewCard";
import {
  NewExperimentCampaignPipelinePreviewCard,
  type NewExperimentCampaignPipelinePreview,
} from "./NewExperimentCampaignPipelinePreviewCard";
import { NewExperimentCampaignPreviewSection } from "./NewExperimentCampaignPreviewPrimitives";

export function NewExperimentCampaignDatasetInputsSection({
  datasetPreviews,
  hiddenDatasetPreviewCount,
}: {
  datasetPreviews: NewExperimentCampaignDatasetPreview[];
  hiddenDatasetPreviewCount: number;
}) {
  if (datasetPreviews.length === 0 && hiddenDatasetPreviewCount <= 0) return null;

  return (
    <NewExperimentCampaignPreviewSection
      title={campaignPlanSectionTitles.datasets}
      hiddenCount={hiddenDatasetPreviewCount}
      hiddenLabel={campaignPlanHiddenLabels.datasets}
    >
      {datasetPreviews.map((datasetPreview) => (
        <NewExperimentCampaignDatasetPreviewCard
          key={datasetPreview.id}
          datasetPreview={datasetPreview}
        />
      ))}
    </NewExperimentCampaignPreviewSection>
  );
}

export function NewExperimentCampaignPipelineInputsSection({
  pipelinePreviews,
  hiddenPipelinePreviewCount,
}: {
  pipelinePreviews: NewExperimentCampaignPipelinePreview[];
  hiddenPipelinePreviewCount: number;
}) {
  if (pipelinePreviews.length === 0 && hiddenPipelinePreviewCount <= 0) return null;

  return (
    <NewExperimentCampaignPreviewSection
      title={campaignPlanSectionTitles.pipelines}
      hiddenCount={hiddenPipelinePreviewCount}
      hiddenLabel={campaignPlanHiddenLabels.pipelines}
    >
      {pipelinePreviews.map((pipelinePreview) => (
        <NewExperimentCampaignPipelinePreviewCard
          key={pipelinePreview.id}
          pipelinePreview={pipelinePreview}
        />
      ))}
    </NewExperimentCampaignPreviewSection>
  );
}
