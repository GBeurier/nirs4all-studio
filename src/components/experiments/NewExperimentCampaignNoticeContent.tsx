export interface NewExperimentCampaignNoticeContentProps {
  message: string;
  title: string;
}

export function NewExperimentCampaignNoticeContent({
  message,
  title,
}: NewExperimentCampaignNoticeContentProps) {
  return (
    <div>
      <p className="font-medium text-foreground">{title}</p>
      <p className="text-muted-foreground">{message}</p>
    </div>
  );
}
