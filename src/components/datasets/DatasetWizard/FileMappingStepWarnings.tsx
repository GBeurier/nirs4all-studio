import { AlertCircle } from "lucide-react";

import type { FileMappingValidation } from "./FileMappingStepLogic";

interface FileMappingStepWarningsProps {
  validation: FileMappingValidation;
}

export function FileMappingStepWarnings({ validation }: FileMappingStepWarningsProps) {
  if (validation.warning === "missing-x") {
    return (
      <div className="flex items-center gap-2 p-3 bg-amber-500/10 text-amber-600 rounded-lg text-sm">
        <AlertCircle className="h-4 w-4 flex-shrink-0" />
        <span>No feature files (X) detected. At least one X file is required.</span>
      </div>
    );
  }

  if (validation.warning === "missing-train-x") {
    return (
      <div className="flex items-center gap-2 p-3 bg-amber-500/10 text-amber-600 rounded-lg text-sm">
        <AlertCircle className="h-4 w-4 flex-shrink-0" />
        <span>No training data detected. Consider marking at least one X file as 'Train'.</span>
      </div>
    );
  }

  return null;
}
