import { Loader2, Play } from "lucide-react";

import type { ExperimentLaunchState } from "@/lib/experimentLaunchState";

export interface NewExperimentLaunchButtonContentProps {
  actionState: ExperimentLaunchState["actionState"];
  buttonLabel: ExperimentLaunchState["buttonLabel"];
  showSpinner: ExperimentLaunchState["showSpinner"];
}

export function NewExperimentLaunchButtonContent({
  actionState,
  buttonLabel,
  showSpinner,
}: NewExperimentLaunchButtonContentProps) {
  if (showSpinner) {
    return (
      <>
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {buttonLabel}
      </>
    );
  }

  if (actionState === "ready") {
    return (
      <>
        <Play className="mr-2 h-4 w-4" />
        {buttonLabel}
      </>
    );
  }

  return <>{buttonLabel}</>;
}
