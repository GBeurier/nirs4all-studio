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
  return executionAdapter?.statusLabel === "Native adapter";
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
      message: "Reserved for backend-specific method and compute-option checks.",
    };
  }

  if (executionAdapter && isNativeCampaignExecutionAdapterForBackend(campaign, executionAdapter)) {
    return {
      status: "not_evaluated",
      message: `${executionAdapter.label} is selected for this backend; backend-specific method and compute-option checks are not evaluated yet.`,
    };
  }

  return {
    status: "blocking",
    message: executionAdapter?.message ?? "The campaign can describe this backend, but no native launch adapter is available for it.",
  };
}
