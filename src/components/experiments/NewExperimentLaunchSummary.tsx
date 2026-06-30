import type { CampaignPlanPreview } from "@/lib/campaignPlanPreviewTypes";
import type { ExperimentDatasetOption } from "@/lib/experimentDatasetOptions";
import type { NewExperimentExecutionEnvironmentDiagnostics } from "@/lib/experimentExecutionEnvironment";
import type { ExperimentLaunchPayloadPlan } from "@/lib/experimentLaunchPayload";

import { NewExperimentLaunchDatasetBadges } from "./NewExperimentLaunchDatasetBadges";
import { NewExperimentLaunchEnvironmentDetails } from "./NewExperimentLaunchEnvironmentDetails";
import { NewExperimentLaunchHero } from "./NewExperimentLaunchHero";
import { NewExperimentLaunchPayloadDetails } from "./NewExperimentLaunchPayloadDetails";

export interface NewExperimentLaunchSummaryProps {
  campaignPreview: CampaignPlanPreview;
  datasetById: Map<string, ExperimentDatasetOption>;
  executionEnvironmentDiagnostics: NewExperimentExecutionEnvironmentDiagnostics;
  experimentDescription: string;
  experimentName: string;
  launchPayloadPlan: ExperimentLaunchPayloadPlan;
  selectedDatasetIds: string[];
}

export function NewExperimentLaunchSummary({
  campaignPreview,
  datasetById,
  executionEnvironmentDiagnostics,
  experimentDescription,
  experimentName,
  launchPayloadPlan,
  selectedDatasetIds,
}: NewExperimentLaunchSummaryProps) {
  return (
    <>
      <NewExperimentLaunchHero
        campaignPreview={campaignPreview}
        experimentDescription={experimentDescription}
        experimentName={experimentName}
      >
        <NewExperimentLaunchEnvironmentDetails diagnostics={executionEnvironmentDiagnostics} />
        <NewExperimentLaunchPayloadDetails
          campaignPreview={campaignPreview}
          launchPayloadPlan={launchPayloadPlan}
        />
      </NewExperimentLaunchHero>
      <NewExperimentLaunchDatasetBadges
        datasetById={datasetById}
        selectedDatasetIds={selectedDatasetIds}
      />
    </>
  );
}
