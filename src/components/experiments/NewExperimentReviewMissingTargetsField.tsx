import { useTranslation } from "react-i18next";

import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { MissingTargetCount } from "@/lib/experimentTargets";
import type { MissingTargetPolicy } from "@/types/runs";

export interface NewExperimentReviewMissingTargetsFieldProps {
  missingTargetPolicy: MissingTargetPolicy;
  /** Samples without a value for the trained target, for the datasets where it is known. */
  missingTargetCounts?: MissingTargetCount[];
  removalAvailable: boolean;
  onMissingTargetPolicyChange: (value: MissingTargetPolicy) => void;
}

export function NewExperimentReviewMissingTargetsField({
  missingTargetPolicy,
  missingTargetCounts = [],
  removalAvailable,
  onMissingTargetPolicyChange,
}: NewExperimentReviewMissingTargetsFieldProps) {
  const { t } = useTranslation();
  const options: Array<{ value: MissingTargetPolicy; label: string; hint: string; disabled: boolean }> = [
    {
      value: "predict",
      label: t("newExperiment.review.missingTargets.predict"),
      hint: t("newExperiment.review.missingTargets.predictHint"),
      disabled: false,
    },
    {
      value: "remove",
      label: t("newExperiment.review.missingTargets.remove"),
      hint: removalAvailable
        ? t("newExperiment.review.missingTargets.removeHint")
        : t("newExperiment.review.missingTargets.removeUnavailable"),
      disabled: !removalAvailable,
    },
  ];

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-foreground">
        {t("newExperiment.review.missingTargets.title")}
      </legend>
      <p className="text-sm text-muted-foreground">
        {t("newExperiment.review.missingTargets.description")}
      </p>
      {missingTargetCounts.length > 0 && (
        <ul className="text-sm text-amber-700 dark:text-amber-400">
          {missingTargetCounts.map((count) => (
            <li key={count.datasetId}>
              {count.samples === null
                ? t("newExperiment.review.missingTargets.count", { ...count })
                : t("newExperiment.review.missingTargets.countOfSamples", { ...count })}
            </li>
          ))}
        </ul>
      )}
      <RadioGroup
        value={missingTargetPolicy}
        onValueChange={(value) => onMissingTargetPolicyChange(value as MissingTargetPolicy)}
        className="gap-3 pt-1"
      >
        {options.map((option) => (
          <div key={option.value} className="flex items-start gap-3">
            <RadioGroupItem
              id={`missing-target-policy-${option.value}`}
              value={option.value}
              disabled={option.disabled}
              className="mt-0.5"
            />
            <div className="space-y-0.5">
              <Label htmlFor={`missing-target-policy-${option.value}`} className="font-normal">
                {option.label}
              </Label>
              <p className="text-xs text-muted-foreground">{option.hint}</p>
            </div>
          </div>
        ))}
      </RadioGroup>
    </fieldset>
  );
}
