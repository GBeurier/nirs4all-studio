import { TabsContent } from "@/components/ui/tabs";
import { RuntimeDiagnosticsList } from "@/components/runtime";
import type { PipelineRun } from "@/types/runs";
import {
  buildResultArtifactSummary,
  buildResultConformalSummary,
  buildResultExecutionTimeRows,
  buildResultMetricCards,
  buildResultNativeResultsSummary,
  buildResultRelatedLinks,
  buildResultRobustnessLaunchPlan,
  buildResultRobustnessSummary,
  buildResultScoreMetricCards,
  buildResultTuningSummary,
  getResultEmptyMetricsMessage,
} from "./resultDetailData";
import { ResultMetricCardGrid } from "./ResultMetricCardGrid";
import { ResultMetricsArtifactSummary } from "./ResultMetricsArtifactSummary";
import { ResultMetricsConformalSummary } from "./ResultMetricsConformalSummary";
import { ResultMetricsEmptyState } from "./ResultMetricsEmptyState";
import { ResultMetricsErrorState } from "./ResultMetricsErrorState";
import { ResultMetricsExecutionTimes } from "./ResultMetricsExecutionTimes";
import { ResultMetricsExportAction } from "./ResultMetricsExportAction";
import { ResultMetricsRefitNotice } from "./ResultMetricsRefitNotice";
import { ResultMetricsRobustnessLaunchPlan } from "./ResultMetricsRobustnessLaunchPlan";
import { ResultMetricsRobustnessSummary } from "./ResultMetricsRobustnessSummary";
import { ResultMetricsTuningSummary } from "./ResultMetricsTuningSummary";
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
  const nativeResultsSummary = buildResultNativeResultsSummary(pipeline);
  const conformalSummary = buildResultConformalSummary(pipeline);
  const robustnessSummary = buildResultRobustnessSummary(pipeline);
  const robustnessLaunchPlan = buildResultRobustnessLaunchPlan(pipeline);
  const tuningSummary = buildResultTuningSummary(pipeline);

  return (
    <TabsContent value="results" className="m-0 space-y-4">
      {hasMetrics ? (
        <>
          {pipeline.has_refit && <ResultMetricsRefitNotice />}

          <RuntimeDiagnosticsList source={pipeline} />

          {scoreMetricCards.length > 0 && <ResultMetricCardGrid cards={scoreMetricCards} />}

          {metricCards.length > 0 && <ResultMetricCardGrid cards={metricCards} />}

          {executionTimeRows.length > 0 && <ResultMetricsExecutionTimes rows={executionTimeRows} />}

          <ResultMetricsArtifactSummary summary={artifactSummary} />

          <ResultMetricsTuningSummary summary={tuningSummary} />

          <ResultMetricsConformalSummary summary={conformalSummary} />

          <ResultMetricsRobustnessLaunchPlan plan={robustnessLaunchPlan} />

          <ResultMetricsRobustnessSummary summary={robustnessSummary} />

          {pipeline.status === "completed" && (
            <ResultMetricsExportAction
              hasRefit={pipeline.has_refit}
              hasNativeResults={nativeResultsSummary.hasNativeResults}
              nativeArtifactCount={nativeResultsSummary.artifactCount}
            />
          )}

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
