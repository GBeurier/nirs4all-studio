import { useTranslation } from "react-i18next";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MISSING_SPECTRA_FILL_METHODS, type MissingSpectraReview } from "@/lib/experimentMissingSpectra";
import type { MissingSpectraFillMethod, MissingSpectraPolicy } from "@/types/runs";

const POLICIES = ["remove", "replace", "keep"] as const;

function fillOf(method: MissingSpectraFillMethod, value: number): MissingSpectraPolicy {
  return { policy: "replace", fill: method === "value" ? { method, fill_value: value } : { method } };
}

/**
 * Asks what a run does with missing spectral values. Shown only when a
 * selected dataset keeps some; nothing is preselected unless the datasets
 * carry a saved answer.
 */
export function NewExperimentReviewMissingSpectraField({ counts, choice, onChange }: MissingSpectraReview) {
  const { t } = useTranslation();
  if (counts.length === 0) return null;
  const fill = choice?.policy === "replace" ? choice.fill : null;
  const fillValue = fill?.method === "value" ? fill.fill_value : 0;

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-foreground">
        {t("newExperiment.review.missingSpectra.title")}
      </legend>
      <p className="text-sm text-muted-foreground">
        {t("newExperiment.review.missingSpectra.description")}
      </p>
      <ul className="text-sm text-amber-700 dark:text-amber-400">
        {counts.map((count) => (
          <li key={count.datasetId}>
            {count.totalSamples === null
              ? t("newExperiment.review.missingSpectra.count", { ...count })
              : t("newExperiment.review.missingSpectra.countOfSamples", { ...count })}
          </li>
        ))}
      </ul>
      {choice === null && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {t("newExperiment.review.missingSpectra.required")}
        </p>
      )}
      <RadioGroup
        value={choice?.policy ?? ""}
        onValueChange={(value) => onChange(value === "replace" ? fillOf("value", 0) : { policy: value as "remove" | "keep" })}
        className="gap-3 pt-1"
      >
        {POLICIES.map((policy) => (
          <div key={policy} className="flex items-start gap-3">
            <RadioGroupItem id={`missing-spectra-policy-${policy}`} value={policy} className="mt-0.5" />
            <div className="space-y-0.5">
              <Label htmlFor={`missing-spectra-policy-${policy}`} className="font-normal">
                {t(`newExperiment.review.missingSpectra.${policy}`)}
              </Label>
              <p className="text-xs text-muted-foreground">{t(`newExperiment.review.missingSpectra.${policy}Hint`)}</p>
              {policy === "replace" && fill && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Select value={fill.method} onValueChange={(method) => onChange(fillOf(method as MissingSpectraFillMethod, fillValue))}>
                    <SelectTrigger className="h-8 w-72" aria-label={t("newExperiment.review.missingSpectra.fillMethod")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MISSING_SPECTRA_FILL_METHODS.map((method) => (
                        <SelectItem key={method} value={method}>
                          {t(`newExperiment.review.missingSpectra.fill.${method}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {fill.method === "value" && (
                    <Input
                      type="number"
                      step="any"
                      className="h-8 w-28"
                      aria-label={t("newExperiment.review.missingSpectra.fillValue")}
                      value={fillValue}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (event.target.value !== "" && Number.isFinite(value)) onChange(fillOf("value", value));
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </RadioGroup>
    </fieldset>
  );
}
