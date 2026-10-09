import i18n from "i18next";

import type { CampaignExecutionAdapterPreview } from "./campaignPlanPreviewTypes";
import type { CampaignCapabilityCheckStatus } from "./campaignCapabilityTypes";
import type { CampaignExecutionBackend, CampaignSpec } from "./campaignSpecTypes";
import type { ExperimentExecutionAdapterId } from "./experimentExecutionAdapter";

export interface CampaignCapabilityStatusResult {
  status: CampaignCapabilityCheckStatus;
  message: string;
}

const NATIVE_EXECUTION_ADAPTER_ID_BY_BACKEND: Record<CampaignExecutionBackend, ExperimentExecutionAdapterId> = {
  "local-python": "legacy-local",
  cluster: "cluster",
  "wasm-local": "wasm-local",
};

export function isNativeCampaignExecutionAdapter(
  executionAdapter: CampaignExecutionAdapterPreview | undefined,
): boolean {
  return executionAdapter?.statusLabel === i18n.t("newExperiment.campaign.adapter.native");
}

export function isNativeCampaignExecutionAdapterForBackend(
  campaign: Pick<CampaignSpec, "executionBackend">,
  executionAdapter: CampaignExecutionAdapterPreview | undefined,
): boolean {
  return executionAdapter?.id === NATIVE_EXECUTION_ADAPTER_ID_BY_BACKEND[campaign.executionBackend];
}

export function getCampaignExecutionBackendCapabilityStatus(
  campaign: Pick<CampaignSpec, "executionBackend">,
  executionAdapter?: CampaignExecutionAdapterPreview,
): CampaignCapabilityStatusResult {
  if (campaign.executionBackend === "local-python") {
    return {
      status: "not_evaluated",
      message: i18n.t("newExperiment.campaign.backendCapability.reserved"),
    };
  }

  if (executionAdapter && isNativeCampaignExecutionAdapterForBackend(campaign, executionAdapter)) {
    return {
      status: "not_evaluated",
      message: i18n.t("newExperiment.campaign.backendCapability.selected", { label: executionAdapter.label }),
    };
  }

  return {
    status: "blocking",
    message: executionAdapter?.message ?? i18n.t("newExperiment.campaign.backendCapability.noAdapter"),
  };
}
