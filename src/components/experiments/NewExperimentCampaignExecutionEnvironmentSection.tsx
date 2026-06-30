import type { NewExperimentExecutionEnvironmentDiagnostics } from "@/lib/experimentExecutionEnvironment";
import { buildNewExperimentExecutionEnvironmentDiagnosticFields } from "@/lib/experimentExecutionEnvironmentPresentation";
import { campaignPlanSectionTitles } from "@/lib/campaignPlanPresentation";

import {
  campaignPreviewCardClass,
  NewExperimentCampaignPreviewSection,
} from "./NewExperimentCampaignPreviewPrimitives";

export interface NewExperimentCampaignExecutionEnvironmentSectionProps {
  diagnostics?: NewExperimentExecutionEnvironmentDiagnostics;
}

export function NewExperimentCampaignExecutionEnvironmentSection({
  diagnostics,
}: NewExperimentCampaignExecutionEnvironmentSectionProps) {
  if (!diagnostics) return null;

  const fields = buildNewExperimentExecutionEnvironmentDiagnosticFields(diagnostics);

  return (
    <NewExperimentCampaignPreviewSection title={campaignPlanSectionTitles.executionEnvironment}>
      <div className={campaignPreviewCardClass}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {fields.map((field) => (
            <div key={field.id}>
              <span className="text-xs text-muted-foreground">{field.label}</span>
              <p className="font-medium text-foreground">{field.value}</p>
            </div>
          ))}
        </div>
      </div>
    </NewExperimentCampaignPreviewSection>
  );
}
