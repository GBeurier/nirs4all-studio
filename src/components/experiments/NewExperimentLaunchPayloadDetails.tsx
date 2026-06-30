import { Badge } from "@/components/ui/badge";
import type { CampaignPlanPreview } from "@/lib/campaignPlanPreviewTypes";
import type { ExperimentLaunchPayloadPlan } from "@/lib/experimentLaunchPayload";
import {
  buildExperimentLaunchPayloadBadgeLabels,
  buildExperimentLaunchPayloadManifestDetails,
  formatExperimentLaunchPayloadActivationLine,
  formatExperimentLaunchPayloadStatusLine,
} from "@/lib/experimentLaunchPresentation";

import { NewExperimentLaunchDetailCard } from "./NewExperimentLaunchDetailCard";

export interface NewExperimentLaunchPayloadDetailsProps {
  campaignPreview: CampaignPlanPreview;
  launchPayloadPlan: ExperimentLaunchPayloadPlan;
}

export function NewExperimentLaunchPayloadDetails({
  campaignPreview,
  launchPayloadPlan,
}: NewExperimentLaunchPayloadDetailsProps) {
  const payloadBadgeLabels = buildExperimentLaunchPayloadBadgeLabels(launchPayloadPlan);
  const payloadManifestDetails = buildExperimentLaunchPayloadManifestDetails(
    launchPayloadPlan,
    campaignPreview,
  );

  return (
    <NewExperimentLaunchDetailCard fields={payloadManifestDetails}>
      <div className="flex flex-wrap justify-center gap-2">
        {payloadBadgeLabels.map((badge) => (
          <Badge key={badge.id} variant={badge.variant}>{badge.label}</Badge>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {formatExperimentLaunchPayloadStatusLine(launchPayloadPlan)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {formatExperimentLaunchPayloadActivationLine(launchPayloadPlan)}
      </p>
    </NewExperimentLaunchDetailCard>
  );
}
