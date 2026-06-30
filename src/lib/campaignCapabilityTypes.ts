export type CampaignCapabilityCheckStatus = "not_evaluated" | "passed" | "warning" | "blocking";

export interface CampaignCapabilityCheck {
  id: string;
  status: CampaignCapabilityCheckStatus;
  statusLabel: string;
  title: string;
  message: string;
}
