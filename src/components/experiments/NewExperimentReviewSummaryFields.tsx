import type { ExperimentReviewSummaryField } from "@/lib/experimentReviewPresentation";

export interface NewExperimentReviewSummaryFieldsProps {
  fields: readonly ExperimentReviewSummaryField[];
}

export function NewExperimentReviewSummaryFields({
  fields,
}: NewExperimentReviewSummaryFieldsProps) {
  return (
    <div className="grid grid-cols-3 gap-4 text-sm">
      {fields.map((field) => (
        <div key={field.id}>
          <span className="text-muted-foreground">{field.label}</span>
          <p className="font-semibold text-foreground">{field.value}</p>
        </div>
      ))}
    </div>
  );
}
