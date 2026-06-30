import type { NewExperimentExecutionEnvironmentDiagnostics } from "@/lib/experimentExecutionEnvironment";
import { buildNewExperimentExecutionEnvironmentDiagnosticFields } from "@/lib/experimentExecutionEnvironmentPresentation";

import { NewExperimentLaunchDetailCard } from "./NewExperimentLaunchDetailCard";

export interface NewExperimentLaunchEnvironmentDetailsProps {
  diagnostics: NewExperimentExecutionEnvironmentDiagnostics;
}

export function NewExperimentLaunchEnvironmentDetails({
  diagnostics,
}: NewExperimentLaunchEnvironmentDetailsProps) {
  const fields = buildNewExperimentExecutionEnvironmentDiagnosticFields(diagnostics);

  return (
    <NewExperimentLaunchDetailCard fields={fields} title="Execution environment" />
  );
}
