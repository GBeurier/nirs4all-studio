import { campaignPlanSectionTitles } from "@/lib/campaignPlanPresentation";

import {
  NewExperimentCampaignCapabilityCard,
  type NewExperimentCampaignCapabilityCheck,
} from "./NewExperimentCampaignCapabilityCard";
import { NewExperimentCampaignPreviewSection } from "./NewExperimentCampaignPreviewPrimitives";

export function NewExperimentCampaignCapabilitySection({
  capabilityChecks,
}: {
  capabilityChecks: NewExperimentCampaignCapabilityCheck[];
}) {
  if (capabilityChecks.length === 0) return null;

  return (
    <NewExperimentCampaignPreviewSection title={campaignPlanSectionTitles.capabilities}>
      {capabilityChecks.map((check) => (
        <NewExperimentCampaignCapabilityCard key={check.id} check={check} />
      ))}
    </NewExperimentCampaignPreviewSection>
  );
}
