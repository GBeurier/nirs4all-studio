import {
  NewExperimentCampaignCompatibilityCheckRow,
  type NewExperimentCampaignCompatibilityCheck,
} from "./NewExperimentCampaignCompatibilityCheckRow";

export interface NewExperimentCampaignCompatibilityChecksListProps {
  checks: readonly NewExperimentCampaignCompatibilityCheck[];
}

export function NewExperimentCampaignCompatibilityChecksList({
  checks,
}: NewExperimentCampaignCompatibilityChecksListProps) {
  if (checks.length === 0) return null;

  return (
    <div className="mt-2 space-y-1 text-xs text-muted-foreground">
      {checks.map((check) => (
        <NewExperimentCampaignCompatibilityCheckRow key={check.id} check={check} />
      ))}
    </div>
  );
}
