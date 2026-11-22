import { formatStoredExecutionName } from "@/lib/runs/format";
import { N4aExportButton } from '@/components/exports/N4aExportButton';
import { buildPipelineRunArtifactRefs } from '@/lib/resultArtifacts';
import { useTranslation } from "react-i18next";
import { TabsContent } from "@/components/ui/tabs";
import { RuntimeDiagnosticsList } from "@/components/runtime";
import type { PipelineRun } from "@/types/runs";
import {
  buildResultArtifactSummary,
  buildResultConformalSummary,
  buildResultExecutionTimeRows,
  buildResultMetricCards,
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
  const { t } = useTranslation();
  const scoreMetricCards = buildResultScoreMetricCards(pipeline, t);
  const metricCards = buildResultMetricCards(pipeline, t);
  const executionTimeRows = buildResultExecutionTimeRows(pipeline, t);
  const relatedLinks = buildResultRelatedLinks(pipeline, datasetName, t);
  const artifactSummary = buildResultArtifactSummary(pipeline);
  const conformalSummary = buildResultConformalSummary(pipeline);
  const robustnessSummary = buildResultRobustnessSummary(pipeline);
  const robustnessLaunchPlan = buildResultRobustnessLaunchPlan(pipeline, t);
  const tuningSummary = buildResultTuningSummary(pipeline, t);

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
            <N4aExportButton label={pipeline.has_refit ? "Export Final Model (.n4a)" : "Export .n4a"} filename={formatStoredExecutionName(pipeline.pipeline_name)} bundlePath={buildPipelineRunArtifactRefs(pipeline).find(ref => ref.bundlePath)?.bundlePath ?? undefined} sections={[
              { id: 'results', label: 'Run results', description: 'Stored metrics, configuration and result references', payload: pipeline },
              { id: 'model', label: 'Trained model', description: 'Preserve the existing fitted archive and prediction entrypoint', payload: true, disabled: !buildPipelineRunArtifactRefs(pipeline).some(ref => ref.bundlePath) },
            ]} />
          )}


          <ResultMetricsRelatedLinks links={relatedLinks} />
        </>
      ) : (
        <ResultMetricsEmptyState message={getResultEmptyMetricsMessage(pipeline.status, t)} />
      )}

      {pipeline.status === "failed" && pipeline.error_message && (
        <ResultMetricsErrorState message={pipeline.error_message} />
      )}
    </TabsContent>
  );
}
