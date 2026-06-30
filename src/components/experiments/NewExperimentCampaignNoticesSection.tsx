import {
  NewExperimentCampaignNoticeRow,
  type NewExperimentCampaignNotice,
} from "./NewExperimentCampaignNoticeRow";

export function NewExperimentCampaignNoticesSection({
  notices,
}: {
  notices: NewExperimentCampaignNotice[];
}) {
  if (notices.length === 0) return null;

  return (
    <div className="space-y-2">
      {notices.map((notice) => (
        <NewExperimentCampaignNoticeRow key={notice.id} notice={notice} />
      ))}
    </div>
  );
}
