import type { CampaignPlanPreview } from "@/lib/campaignPlanPreviewTypes";
import type { NewExperimentExecutionEnvironmentDiagnostics } from "@/lib/experimentExecutionEnvironment";
import { campaignPlanPreviewTitle } from "@/lib/campaignPlanPresentation";

import { NewExperimentCampaignPreviewSections } from "./NewExperimentCampaignPreviewSections";

export interface NewExperimentCampaignPlanPreviewProps {
  campaignPreview: CampaignPlanPreview;
  executionEnvironmentDiagnostics?: NewExperimentExecutionEnvironmentDiagnostics;
}

export function NewExperimentCampaignPlanPreview({
  campaignPreview,
  executionEnvironmentDiagnostics,
}: NewExperimentCampaignPlanPreviewProps) {
  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
      <h3 className="text-sm font-medium text-foreground">{campaignPlanPreviewTitle}</h3>
      <NewExperimentCampaignPreviewSections
        campaignPreview={campaignPreview}
        executionEnvironmentDiagnostics={executionEnvironmentDiagnostics}
      />
    </div>
  );
}
