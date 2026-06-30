export interface NewExperimentCampaignPreviewDetailLabelsProps {
  labels: string[];
}

export function NewExperimentCampaignPreviewDetailLabels({
  labels,
}: NewExperimentCampaignPreviewDetailLabelsProps) {
  if (labels.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
      {labels.map((label) => (
        <span key={label}>{label}</span>
      ))}
    </div>
  );
}
