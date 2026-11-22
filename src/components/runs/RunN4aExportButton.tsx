import { useTranslation } from "react-i18next";
import { N4aExportButton } from "@/components/exports/N4aExportButton";
import type { EnrichedRun } from "@/types/enriched-runs";

export function RunN4aExportButton({ runs, workspaceId, filename }: {
  runs: readonly EnrichedRun[];
  workspaceId: string;
  filename: string;
}) {
  const { t } = useTranslation();
  return (
    <N4aExportButton
      runIds={runs.map(run => run.run_id)}
      workspaceId={workspaceId}
      filename={filename}
      label={t("runs.export.label")}
      sections={[
        { id: "recipe", label: t("runs.export.recipe"), payload: true },
        { id: "results", label: t("runs.export.results"), payload: true },
        {
          id: "model",
          label: t("runs.export.models"),
          description: t("runs.export.modelsHint"),
          payload: true,
          checkedByDefault: false,
          disabled: !runs.some(run => run.final_models_count > 0),
        },
      ]}
    />
  );
}
