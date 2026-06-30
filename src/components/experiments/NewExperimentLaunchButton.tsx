import { Button } from "@/components/ui/button";
import type { ExperimentLaunchState } from "@/lib/experimentLaunchState";

import { NewExperimentLaunchButtonContent } from "./NewExperimentLaunchButtonContent";

export interface NewExperimentLaunchButtonProps {
  launchState: ExperimentLaunchState;
  onLaunch: () => void;
}

export function NewExperimentLaunchButton({
  launchState,
  onLaunch,
}: NewExperimentLaunchButtonProps) {
  return (
    <Button size="lg" onClick={onLaunch} disabled={launchState.isLaunchDisabled}>
      <NewExperimentLaunchButtonContent
        actionState={launchState.actionState}
        buttonLabel={launchState.buttonLabel}
        showSpinner={launchState.showSpinner}
      />
    </Button>
  );
}
