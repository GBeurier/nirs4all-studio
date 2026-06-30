import type { CampaignSummaryField } from "@/lib/campaignPlanPresentation";

export interface NewExperimentCampaignSummaryFieldsProps {
  fields: readonly CampaignSummaryField[];
}

export function NewExperimentCampaignSummaryFields({
  fields,
}: NewExperimentCampaignSummaryFieldsProps) {
  return (
    <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3 xl:grid-cols-6">
      {fields.map((field) => (
        <SummaryField key={field.id} label={field.label} value={field.value} />
      ))}
    </div>
  );
}

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}</span>
      <p className="font-semibold text-foreground">{value}</p>
    </div>
  );
}
