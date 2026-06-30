import {
  campaignPlanHiddenLabels,
  campaignPlanSectionTitles,
} from "@/lib/campaignPlanPresentation";

import {
  NewExperimentCampaignCompatibilityCard,
  type NewExperimentCampaignCompatibilityPreview,
} from "./NewExperimentCampaignCompatibilityCard";
import { NewExperimentCampaignPreviewSection } from "./NewExperimentCampaignPreviewPrimitives";

export function NewExperimentCampaignCompatibilitySection({
  compatibilityPreviews,
  hiddenCompatibilityPreviewCount,
}: {
  compatibilityPreviews: NewExperimentCampaignCompatibilityPreview[];
  hiddenCompatibilityPreviewCount: number;
}) {
  if (compatibilityPreviews.length === 0 && hiddenCompatibilityPreviewCount <= 0) return null;

  return (
    <NewExperimentCampaignPreviewSection
      title={campaignPlanSectionTitles.compatibility}
      hiddenCount={hiddenCompatibilityPreviewCount}
      hiddenLabel={campaignPlanHiddenLabels.compatibility}
    >
      {compatibilityPreviews.map((compatibilityPreview) => (
        <NewExperimentCampaignCompatibilityCard
          key={compatibilityPreview.id}
          compatibilityPreview={compatibilityPreview}
        />
      ))}
    </NewExperimentCampaignPreviewSection>
  );
}
