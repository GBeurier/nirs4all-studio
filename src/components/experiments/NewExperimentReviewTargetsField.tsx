import { useTranslation } from "react-i18next";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ALL_TARGET_COLUMNS,
  type ExperimentTargetChoice,
  type ExperimentTargetOption,
} from "@/lib/experimentTargets";

/** Select value of "all target columns together"; no file column can be named so. */
const ALL_COLUMNS_VALUE = "\u0000all-target-columns";

export interface NewExperimentReviewTargetsFieldProps {
  targetOptions: ExperimentTargetOption[];
  onTargetChange: (datasetId: string, target: ExperimentTargetChoice) => void;
}

/** Asks which target column each dataset with several of them is trained on. */
export function NewExperimentReviewTargetsField({
  targetOptions,
  onTargetChange,
}: NewExperimentReviewTargetsFieldProps) {
  const { t } = useTranslation();
  if (targetOptions.length === 0) return null;

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-foreground">
        {t("newExperiment.review.targets.title")}
      </legend>
      <p className="text-sm text-muted-foreground">
        {t("newExperiment.review.targets.description")}
      </p>
      <div className="space-y-2 pt-1">
        {targetOptions.map((option) => {
          const id = `experiment-target-${option.datasetId}`;
          return (
            <div key={option.datasetId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Label htmlFor={id} className="min-w-40 font-normal">{option.datasetName}</Label>
              <Select
                value={option.selected ?? ALL_COLUMNS_VALUE}
                onValueChange={(value) => onTargetChange(
                  option.datasetId,
                  value === ALL_COLUMNS_VALUE ? ALL_TARGET_COLUMNS : value,
                )}
              >
                <SelectTrigger id={id} className="w-80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {option.targets.map((target) => (
                    <SelectItem key={target.column} value={target.column}>
                      {target.missing_count
                        ? t("newExperiment.review.targets.columnWithMissing", { column: target.column, missing: target.missing_count })
                        : target.column}
                    </SelectItem>
                  ))}
                  <SelectItem value={ALL_COLUMNS_VALUE}>
                    {t("newExperiment.review.targets.allColumns", { total: option.targets.length })}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
