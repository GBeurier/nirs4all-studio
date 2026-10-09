import { useTranslation } from "react-i18next";

import type { NewExperimentExecutionEnvironmentDiagnostics } from "@/lib/experimentExecutionEnvironment";
import { buildNewExperimentExecutionEnvironmentDiagnosticFields } from "@/lib/experimentExecutionEnvironmentPresentation";

import { NewExperimentLaunchDetailCard } from "./NewExperimentLaunchDetailCard";

export interface NewExperimentLaunchEnvironmentDetailsProps {
  diagnostics: NewExperimentExecutionEnvironmentDiagnostics;
}

export function NewExperimentLaunchEnvironmentDetails({
  diagnostics,
}: NewExperimentLaunchEnvironmentDetailsProps) {
  const { t } = useTranslation();
  const fields = buildNewExperimentExecutionEnvironmentDiagnosticFields(diagnostics);

  return (
    <NewExperimentLaunchDetailCard fields={fields} title={t("newExperiment.environment.title")} />
  );
}
