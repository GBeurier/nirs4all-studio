import { AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { FileMappingValidation } from "./FileMappingStepLogic";

interface FileMappingStepWarningsProps {
  validation: FileMappingValidation;
}

export function FileMappingStepWarnings({ validation }: FileMappingStepWarningsProps) {
  const { t } = useTranslation();

  if (validation.warning === "missing-x") {
    return (
      <div className="flex items-center gap-2 p-3 bg-amber-500/10 text-amber-600 rounded-lg text-sm">
        <AlertCircle className="h-4 w-4 flex-shrink-0" />
        <span>{t("datasets.wizard.fileMapping.warnings.missingX")}</span>
      </div>
    );
  }

  if (validation.warning === "missing-train-x") {
    return (
      <div className="flex items-center gap-2 p-3 bg-amber-500/10 text-amber-600 rounded-lg text-sm">
        <AlertCircle className="h-4 w-4 flex-shrink-0" />
        <span>{t("datasets.wizard.fileMapping.warnings.missingTrainX")}</span>
      </div>
    );
  }

  return null;
}
