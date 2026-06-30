import { Textarea } from "@/components/ui/textarea";
import { experimentReviewCopy } from "@/lib/experimentReviewPresentation";

export interface NewExperimentReviewDescriptionFieldProps {
  experimentDescription: string;
  onExperimentDescriptionChange: (value: string) => void;
}

export function NewExperimentReviewDescriptionField({
  experimentDescription,
  onExperimentDescriptionChange,
}: NewExperimentReviewDescriptionFieldProps) {
  return (
    <div>
      <label className="text-sm font-medium text-foreground">
        {experimentReviewCopy.descriptionLabel}
      </label>
      <Textarea
        value={experimentDescription}
        onChange={(event) => onExperimentDescriptionChange(event.target.value)}
        placeholder={experimentReviewCopy.descriptionPlaceholder}
        className="mt-1.5"
        rows={2}
      />
    </div>
  );
}
