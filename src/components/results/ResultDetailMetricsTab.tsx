import { TabsContent } from "@/components/ui/tabs";
import type { PipelineRun } from "@/types/runs";
import {
  buildResultArtifactSummary,
  buildResultExecutionTimeRows,
  buildResultMetricCards,
  buildResultRelatedLinks,
  buildResultScoreMetricCards,
  getResultEmptyMetricsMessage,
} from "./resultDetailData";
import { ResultMetricCardGrid } from "./ResultMetricCardGrid";
import { ResultMetricsArtifactSummary } from "./ResultMetricsArtifactSummary";
import { ResultMetricsEmptyState } from "./ResultMetricsEmptyState";
import { ResultMetricsErrorState } from "./ResultMetricsErrorState";
import { ResultMetricsExecutionTimes } from "./ResultMetricsExecutionTimes";
import { ResultMetricsExportAction } from "./ResultMetricsExportAction";
import { ResultMetricsRefitNotice } from "./ResultMetricsRefitNotice";
import { ResultMetricsRelatedLinks } from "./ResultMetricsRelatedLinks";

interface ResultDetailMetricsTabProps {
  pipeline: PipelineRun;
  datasetName: string;
  hasMetrics: boolean;
}

export function ResultDetailMetricsTab({ pipeline, datasetName, hasMetrics }: ResultDetailMetricsTabProps) {
  const scoreMetricCards = buildResultScoreMetricCards(pipeline);
  const metricCards = buildResultMetricCards(pipeline);
  const executionTimeRows = buildResultExecutionTimeRows(pipeline);
  const relatedLinks = buildResultRelatedLinks(pipeline, datasetName);
  const artifactSummary = buildResultArtifactSummary(pipeline);

  return (
    <TabsContent value="results" className="m-0 space-y-4">
      {hasMetrics ? (
        <>
          {pipeline.has_refit && <ResultMetricsRefitNotice />}

          {scoreMetricCards.length > 0 && <ResultMetricCardGrid cards={scoreMetricCards} />}

          {metricCards.length > 0 && <ResultMetricCardGrid cards={metricCards} />}

          {executionTimeRows.length > 0 && <ResultMetricsExecutionTimes rows={executionTimeRows} />}

          <ResultMetricsArtifactSummary summary={artifactSummary} />

          {pipeline.status === "completed" && <ResultMetricsExportAction hasRefit={pipeline.has_refit} />}

          <ResultMetricsRelatedLinks links={relatedLinks} />
        </>
      ) : (
        <ResultMetricsEmptyState message={getResultEmptyMetricsMessage(pipeline.status)} />
      )}

      {pipeline.status === "failed" && pipeline.error_message && (
        <ResultMetricsErrorState message={pipeline.error_message} />
      )}
    </TabsContent>
  );
}
