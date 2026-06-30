import type { CampaignPlanPreview } from "@/lib/campaignPlanPreviewTypes";
import { NewExperimentCampaignNoticeContent } from "./NewExperimentCampaignNoticeContent";
import { NewExperimentCampaignNoticeSeverityBadge } from "./NewExperimentCampaignNoticeSeverityBadge";

export type NewExperimentCampaignNotice = CampaignPlanPreview["notices"][number];

export interface NewExperimentCampaignNoticeRowProps {
  notice: NewExperimentCampaignNotice;
}

export function NewExperimentCampaignNoticeRow({
  notice,
}: NewExperimentCampaignNoticeRowProps) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-border/50 bg-background/70 px-3 py-2 text-sm">
      <NewExperimentCampaignNoticeSeverityBadge severity={notice.severity} />
      <NewExperimentCampaignNoticeContent
        message={notice.message}
        title={notice.title}
      />
    </div>
  );
}
