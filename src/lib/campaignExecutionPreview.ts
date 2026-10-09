import i18n from "i18next";

import { resolveExperimentExecutionAdapter } from "./experimentExecutionAdapter";
import type { ExperimentExecutionAdapter } from "./experimentExecutionAdapter";
import type { NewExperimentNativeBackendAvailability } from "./experimentExecutionEnvironment";
import type {
  CampaignExecutionAdapterPreview,
} from "./campaignPlanPreviewTypes";
import type { CampaignExecutionBackend, CampaignSpec } from "./campaignSpecTypes";

export function getCampaignExecutionBackendLabel(backend: CampaignExecutionBackend): string {
  if (backend === "cluster") return i18n.t("newExperiment.campaign.backend.cluster");
  if (backend === "wasm-local") return i18n.t("newExperiment.campaign.backend.wasmLocal");
  return i18n.t("newExperiment.campaign.backend.localPython");
}

export function buildCampaignExecutionAdapterPreview(
  campaign: Pick<CampaignSpec, "executionBackend">,
  options: {
    availableExecutionAdapters?: readonly ExperimentExecutionAdapter[];
    nativeBackendAvailability?: readonly NewExperimentNativeBackendAvailability[];
  } = {},
): CampaignExecutionAdapterPreview {
  const resolution = resolveExperimentExecutionAdapter(campaign.executionBackend, {
    availableAdapters: options.availableExecutionAdapters,
  });
  const nativeAvailability = options.nativeBackendAvailability?.find(
    (availability) => availability.backend === campaign.executionBackend,
  );
  const shouldUseNativeAvailabilityMessage = (
    !resolution.isNativeForBackend
    && campaign.executionBackend !== "local-python"
    && nativeAvailability != null
    && nativeAvailability?.status !== "available"
  );

  return {
    id: resolution.adapter.id,
    label: resolution.adapter.label,
    statusLabel: resolution.statusLabel,
    message: resolution.isNativeForBackend || campaign.executionBackend === "local-python"
      ? resolution.message
      : shouldUseNativeAvailabilityMessage
        ? nativeAvailability.message
        : resolution.message,
  };
}
