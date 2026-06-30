export type CampaignPreviewNoticeSeverity = "info" | "warning" | "blocking";

export interface CampaignPreviewNotice {
  id: string;
  severity: CampaignPreviewNoticeSeverity;
  title: string;
  message: string;
}
