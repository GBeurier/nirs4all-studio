import { getExperimentLaunchState } from "@/lib/experimentLaunchState";
import type { CampaignPlanPreview } from "@/lib/campaignPlanPreviewTypes";
import type { ExperimentDatasetOption } from "@/lib/experimentDatasetOptions";
import type { NewExperimentExecutionEnvironmentDiagnostics } from "@/lib/experimentExecutionEnvironment";
import type { ExperimentLaunchPayloadPlan } from "@/lib/experimentLaunchPayload";

import { NewExperimentLaunchBlockingNotices } from "./NewExperimentLaunchBlockingNotices";
import { NewExperimentLaunchButton } from "./NewExperimentLaunchButton";
import { NewExperimentLaunchSummary } from "./NewExperimentLaunchSummary";

export interface NewExperimentLaunchStepProps {
  campaignPreview: CampaignPlanPreview;
  datasetById: Map<string, ExperimentDatasetOption>;
  executionEnvironmentDiagnostics: NewExperimentExecutionEnvironmentDiagnostics;
  experimentDescription: string;
  experimentName: string;
  isLaunching: boolean;
  isPreflighting: boolean;
  launchPayloadPlan: ExperimentLaunchPayloadPlan;
  selectedDatasetIds: string[];
  onLaunch: () => void;
}

export function NewExperimentLaunchStep({
  campaignPreview,
  datasetById,
  experimentDescription,
  experimentName,
  isLaunching,
  isPreflighting,
  launchPayloadPlan,
  selectedDatasetIds,
  onLaunch,
}: NewExperimentLaunchStepProps) {
  const launchState = getExperimentLaunchState({
    campaignPreview,
    isLaunching,
    isPreflighting,
    launchPayloadPlan,
  });

  return (
    <div className="space-y-6 py-8 text-center">
      <NewExperimentLaunchSummary
        campaignPreview={campaignPreview}
        datasetById={datasetById}
        experimentDescription={experimentDescription}
        experimentName={experimentName}
        selectedDatasetIds={selectedDatasetIds}
      />
      <NewExperimentLaunchBlockingNotices blockingNotices={launchState.blockingNotices} />
      <NewExperimentLaunchButton launchState={launchState} onLaunch={onLaunch} />
    </div>
  );
}
