import type { CampaignPlanPreview } from "@/lib/campaignPlanPreviewTypes";
import type { NewExperimentExecutionEnvironmentDiagnostics } from "@/lib/experimentExecutionEnvironment";

import { NewExperimentCampaignCapabilitySection } from "./NewExperimentCampaignCapabilitySection";
import { NewExperimentCampaignCompatibilitySection } from "./NewExperimentCampaignCompatibilitySection";
import { NewExperimentCampaignExecutionEnvironmentSection } from "./NewExperimentCampaignExecutionEnvironmentSection";
import {
  NewExperimentCampaignDatasetInputsSection,
  NewExperimentCampaignPipelineInputsSection,
} from "./NewExperimentCampaignInputSections";
import { NewExperimentCampaignNoticesSection } from "./NewExperimentCampaignNoticesSection";
import { NewExperimentCampaignRunSection } from "./NewExperimentCampaignRunSection";
import { NewExperimentCampaignPreviewSummary } from "./NewExperimentCampaignPreviewSummary";
import { NewExperimentCampaignSinglePairSplitSection } from "./NewExperimentCampaignSinglePairSplitSection";

export interface NewExperimentCampaignPreviewSectionsProps {
  campaignPreview: CampaignPlanPreview;
  executionEnvironmentDiagnostics?: NewExperimentExecutionEnvironmentDiagnostics;
}

export function NewExperimentCampaignPreviewSections({
  campaignPreview,
  executionEnvironmentDiagnostics,
}: NewExperimentCampaignPreviewSectionsProps) {
  return (
    <>
      <NewExperimentCampaignPreviewSummary campaignPreview={campaignPreview} />
      <NewExperimentCampaignExecutionEnvironmentSection diagnostics={executionEnvironmentDiagnostics} />
      <NewExperimentCampaignCapabilitySection capabilityChecks={campaignPreview.capabilityChecks} />
      <NewExperimentCampaignDatasetInputsSection
        datasetPreviews={campaignPreview.datasetPreviews}
        hiddenDatasetPreviewCount={campaignPreview.hiddenDatasetPreviewCount}
      />
      <NewExperimentCampaignPipelineInputsSection
        pipelinePreviews={campaignPreview.pipelinePreviews}
        hiddenPipelinePreviewCount={campaignPreview.hiddenPipelinePreviewCount}
      />
      <NewExperimentCampaignCompatibilitySection
        compatibilityPreviews={campaignPreview.compatibilityPreviews}
        hiddenCompatibilityPreviewCount={campaignPreview.hiddenCompatibilityPreviewCount}
      />
      <NewExperimentCampaignSinglePairSplitSection
        singlePairSplitPreview={campaignPreview.singlePairSplitPreview}
      />
      <NewExperimentCampaignRunSection
        runPreviews={campaignPreview.runPreviews}
        hiddenRunCount={campaignPreview.hiddenRunCount}
      />
      <NewExperimentCampaignNoticesSection notices={campaignPreview.notices} />
    </>
  );
}
