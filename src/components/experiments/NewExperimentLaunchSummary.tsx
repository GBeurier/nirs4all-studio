import type { CampaignPlanPreview } from "@/lib/campaignPlanPreviewTypes";
import type { ExperimentDatasetOption } from "@/lib/experimentDatasetOptions";

import { NewExperimentLaunchDatasetBadges } from "./NewExperimentLaunchDatasetBadges";
import { NewExperimentLaunchHero } from "./NewExperimentLaunchHero";

export interface NewExperimentLaunchSummaryProps {
  campaignPreview: CampaignPlanPreview;
  datasetById: Map<string, ExperimentDatasetOption>;
  experimentDescription: string;
  experimentName: string;
  selectedDatasetIds: string[];
}

export function NewExperimentLaunchSummary({
  campaignPreview,
  datasetById,
  experimentDescription,
  experimentName,
  selectedDatasetIds,
}: NewExperimentLaunchSummaryProps) {
  return (
    <>
      <NewExperimentLaunchHero
        campaignPreview={campaignPreview}
        experimentDescription={experimentDescription}
        experimentName={experimentName}
      />
      <NewExperimentLaunchDatasetBadges
        datasetById={datasetById}
        selectedDatasetIds={selectedDatasetIds}
      />
    </>
  );
}
