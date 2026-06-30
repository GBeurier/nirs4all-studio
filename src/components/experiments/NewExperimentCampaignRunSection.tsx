import {
  campaignPlanHiddenLabels,
  campaignPlanSectionTitles,
} from "@/lib/campaignPlanPresentation";

import { NewExperimentCampaignPreviewSection } from "./NewExperimentCampaignPreviewPrimitives";
import {
  NewExperimentCampaignRunPreviewCard,
  type NewExperimentCampaignRunPreview,
} from "./NewExperimentCampaignRunPreviewCard";

export function NewExperimentCampaignRunSection({
  runPreviews,
  hiddenRunCount,
}: {
  runPreviews: NewExperimentCampaignRunPreview[];
  hiddenRunCount: number;
}) {
  if (runPreviews.length === 0 && hiddenRunCount <= 0) return null;

  return (
    <NewExperimentCampaignPreviewSection
      title={campaignPlanSectionTitles.plannedRuns}
      hiddenCount={hiddenRunCount}
      hiddenLabel={campaignPlanHiddenLabels.plannedRuns}
    >
      {runPreviews.map((runPreview) => (
        <NewExperimentCampaignRunPreviewCard key={runPreview.id} runPreview={runPreview} />
      ))}
    </NewExperimentCampaignPreviewSection>
  );
}
