import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { DatasetResultCard } from "@/components/scores/DatasetResultCard";
import type { EnrichedDatasetRun } from "@/types/enriched-runs";
import { AllModelsPanel } from "./AllModelsPanel";
import { getEmptyDatasetsMessage } from "./RunDetailSheetDisplay";

export function RunDetailSheetDatasets({
  datasets,
  selectedMetrics,
  runId,
  workspaceId,
  status,
}: {
  datasets: EnrichedDatasetRun[];
  selectedMetrics: string[];
  runId: string;
  workspaceId: string;
  status: string;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      {datasets.map((dataset) => (
        <div key={dataset.dataset_name} className="space-y-3 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-medium">{dataset.dataset_name}</h4>
              <p className="text-xs text-muted-foreground">
                {t("runs.detail.datasetHint")}
              </p>
            </div>
            <Badge variant="outline">{t("runs.detail.pipelineCount", { count: dataset.pipeline_count })}</Badge>
          </div>

          <DatasetResultCard
            dataset={dataset}
            selectedMetrics={selectedMetrics}
            runId={runId}
            workspaceId={workspaceId}
            defaultExpanded
          />

          <AllModelsPanel
            workspaceId={workspaceId}
            runId={runId}
            datasetName={dataset.dataset_name}
            taskType={dataset.task_type}
            totalPipelines={dataset.pipeline_count}
          />
        </div>
      ))}

      {datasets.length === 0 && (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {getEmptyDatasetsMessage(status, t)}
        </div>
      )}
    </div>
  );
}
