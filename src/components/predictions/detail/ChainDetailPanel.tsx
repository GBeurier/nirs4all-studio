/**
 * ChainDetailPanel — single-view body rendered inside ChainDetailSheet.
 *
 * Replaces the former three-tab layout (Summary / Folds / Arrays) with a
 * scientifically-ordered scroll: identity header → hero metrics → evidence
 * charts → fold-level table → collapsed identity & arrays details.
 *
 * Composes the detail sheet from bounded presentation sections. Fetch,
 * selection, chart config, and preview projections live in
 * `useChainDetailPanelState`.
 */

import { useState } from "react";
import { foldLabel, foldLabelShort } from "@/lib/fold-utils";
import type {
  ChartKind,
  ViewerHeader,
  ViewerPartitionTarget,
} from "@/components/predictions/viewer/types";
import { exportWorkspaceRobustnessReport } from "@/api/aggregatedPredictions";
import type {
  PredictionRobustnessEvidenceResponse,
  RobustnessReportExportFormat,
} from "@/types/aggregated-predictions";
import { HeroMetrics } from "./HeroMetrics";
import {
  ChainDetailFoldSummary,
  ChainDetailSummaryHeader,
} from "./ChainDetailSummaryHeader";
import { ChainDetailRelatedPredictions } from "./ChainDetailRelatedPredictions";
import { ChainDetailPredictionBreakdown } from "./ChainDetailPredictionBreakdown";
import { ChainDetailChartPreview } from "./ChainDetailChartPreview";
import { ChainDetailChartBody } from "./ChainDetailChartBody";
import { ChainDetailPipelineIdentity } from "./ChainDetailPipelineIdentity";
import { ChainDetailArtifactSummary } from "./ChainDetailArtifactSummary";
import { ChainDetailConformalPredictionPreview } from "./ChainDetailConformalPredictionPreview";
import { ChainDetailRawVectors } from "./ChainDetailRawVectors";
import { ResultMetricsConformalSummary } from "@/components/results/ResultMetricsConformalSummary";
import { ResultMetricsRobustnessSummary } from "@/components/results/ResultMetricsRobustnessSummary";
import { ResultMetricsTuningSummary } from "@/components/results/ResultMetricsTuningSummary";
import type {
  RobustnessScenarioDistribution,
  RobustnessScenarioDistributionOption,
} from "@/ui/robustness";
import { Button } from "@/components/ui/button";
import { downloadBlob } from "@/lib/playground/exportDownload";
import { RobustnessEvidencePreflightCard } from "./RobustnessEvidencePreflightCard";
import { useKeywordRegistry } from "@/hooks/useKeywordRegistry";
import {
  useChainDetailPanelState,
  type ChainDetailFocus,
  type ChainDetailMetaHint,
  type ChainDetailRobustnessScenarioOption,
  type ChainDetailRobustnessScenarioKind,
  type ChainDetailRobustnessUnavailableScenario,
} from "./useChainDetailPanelState";

export type { ChainDetailFocus, ChainDetailMetaHint } from "./useChainDetailPanelState";

const ROBUSTNESS_REPORT_EXPORTS: Array<{
  extension: string;
  format: RobustnessReportExportFormat;
  label: string;
}> = [
  { extension: "json", format: "json", label: "Export JSON" },
  { extension: "md", format: "markdown", label: "Export Markdown" },
  { extension: "html", format: "html", label: "Export HTML" },
];

interface ChainDetailPanelProps {
  chainId: string;
  metric?: string | null;
  metaHint?: ChainDetailMetaHint;
  focus?: ChainDetailFocus;
  onOpenViewer?: (
    partitions: ViewerPartitionTarget[],
    header: ViewerHeader,
    kind: ChartKind,
  ) => void;
  /** When true, hide the inline chart preview — the full viewer is mounted on
   *  top and the preview would otherwise live-update from shared config edits. */
  isViewerOpen?: boolean;
}

export function ChainDetailPanel({ chainId, metric, metaHint, focus, onOpenViewer, isViewerOpen }: ChainDetailPanelProps) {
  const keywordRegistry = useKeywordRegistry();
  const {
    detail,
    prediction,
    loadingSummary,
    selectedFoldId,
    setSelectedFoldId,
    previewKind,
    setPreviewKind,
    panelConfig,
    taskKind,
    foldGroups,
    selectedGroup,
    selectedPrediction,
    selectedFoldPartitions,
    chartTargets,
    chartDatasets,
    chartsLoading,
    chartsError,
    canCustomize,
    handleCustomize,
    chartBodyKey,
    preprocessLabel,
    variantParams,
    bestParams,
    pipelineStats,
    pipelineTree,
    generatorChoices,
    branchPathLabel,
    vectorSummaries,
    arrayData,
    arrayArtifactRef,
    artifactSummary,
    tuningSummary,
    conformalSummary,
    selectedConformalCoverage,
    setSelectedConformalCoverage,
    robustnessSummary,
    computeRobustnessReport,
    computingRobustness,
    generatedRobustnessId,
    robustnessActionError,
    robustnessScenarioKind,
    setRobustnessScenarioKind,
    robustnessScenarioOptions,
    robustnessUnavailableScenarios,
    robustnessSeverity,
    setRobustnessSeverity,
    robustnessDistribution,
    setRobustnessDistribution,
    robustnessDistributionOptions,
    robustnessEvidence,
    loadingRobustnessEvidence,
    robustnessScenarioValidationError,
    canComputeRobustness,
    loadingArrays,
    additionalCvMetricRows,
  } = useChainDetailPanelState({
    chainId,
    metric,
    metaHint,
    focus,
    keywordRegistry: keywordRegistry.data,
    onOpenViewer,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.06),hsl(var(--primary)/0)_32%)]">
      <ChainDetailSummaryHeader
        prediction={prediction}
        selectedFoldLabel={selectedGroup ? foldLabel(selectedGroup.foldId) : null}
        preprocessLabel={preprocessLabel}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-6 px-6 py-5">
          <HeroMetrics
            cvVal={prediction.cv_val_score}
            cvTest={prediction.cv_test_score}
            cvTrain={prediction.cv_train_score}
            foldCount={prediction.cv_fold_count}
            finalTest={prediction.final_test_score}
            metric={prediction.metric || "score"}
          />

          <ChainDetailFoldSummary
            selectedLabel={selectedGroup ? foldLabelShort(selectedGroup.foldId) : "Auto"}
            refitCount={foldGroups.filter((group) => group.kind === "refit").length}
            cvViewCount={foldGroups.filter((group) => group.kind === "cv").length}
            foldCount={foldGroups.filter((group) => group.kind === "fold" && !group.isAggregated).length}
          />

          <ChainDetailRelatedPredictions
            loading={loadingSummary}
            foldGroups={foldGroups}
            selectedFoldId={selectedFoldId}
            onSelectFold={setSelectedFoldId}
          />

          <ChainDetailChartPreview
            previewKind={previewKind}
            onPreviewKindChange={setPreviewKind}
            taskKind={taskKind}
            partitions={chartTargets}
            selectedFoldLabel={selectedGroup ? foldLabel(selectedGroup.foldId) : null}
            selectedPartitionCount={selectedFoldPartitions.length}
            canCustomize={canCustomize}
            onCustomize={handleCustomize}
            isViewerOpen={isViewerOpen}
          >
            <ChainDetailChartBody
              key={chartBodyKey}
              kind={previewKind}
              chartDatasets={chartDatasets}
              chartsLoading={chartsLoading}
              chartsError={chartsError}
              panelConfig={panelConfig}
              taskKind={taskKind}
            />
          </ChainDetailChartPreview>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
            <ChainDetailPredictionBreakdown
              selectedFoldLabel={selectedGroup ? foldLabel(selectedGroup.foldId) : null}
              selectedFoldPartitions={selectedFoldPartitions}
            />

            <ChainDetailPipelineIdentity
              title={detail?.pipeline?.name || prediction.model_class || "Pipeline structure and chosen variants for this chain."}
              modelClass={prediction.model_class || null}
              pipelineName={detail?.pipeline?.name ?? null}
              pipelineStats={pipelineStats}
              pipelineTree={pipelineTree}
              variantParams={variantParams}
              bestParams={bestParams}
              branchPathLabel={branchPathLabel}
              generatorChoiceCount={generatorChoices?.length ?? 0}
              additionalCvMetricRows={additionalCvMetricRows}
              cvFoldCount={prediction.cv_fold_count || 0}
            />
          </div>

          <ChainDetailArtifactSummary summary={artifactSummary} />

          <ResultMetricsTuningSummary summary={tuningSummary} />

          <ResultMetricsConformalSummary summary={conformalSummary} />

          <ChainDetailConformalPredictionPreview
            summary={conformalSummary}
            selectedCoverage={selectedConformalCoverage}
            onSelectedCoverageChange={setSelectedConformalCoverage}
          />

          <ChainDetailRobustnessAction
            canCompute={canComputeRobustness}
            computing={computingRobustness}
            generatedRobustnessId={generatedRobustnessId}
            error={robustnessActionError}
            scenarioKind={robustnessScenarioKind}
            scenarioOptions={robustnessScenarioOptions}
            unavailableScenarios={robustnessUnavailableScenarios}
            severity={robustnessSeverity}
            distribution={robustnessDistribution}
            distributionOptions={robustnessDistributionOptions}
            evidence={robustnessEvidence}
            loadingEvidence={loadingRobustnessEvidence}
            validationError={robustnessScenarioValidationError}
            onCompute={computeRobustnessReport}
            onScenarioKindChange={setRobustnessScenarioKind}
            onSeverityChange={setRobustnessSeverity}
            onDistributionChange={setRobustnessDistribution}
          />

          <ResultMetricsRobustnessSummary summary={robustnessSummary} />

          <ChainDetailRawVectors
            hasSelectedPrediction={!!selectedPrediction}
            loading={loadingArrays || chartsLoading}
            vectorSummaries={vectorSummaries}
            arrayData={arrayData}
            arrayArtifactRef={arrayArtifactRef}
            metric={prediction.metric}
          />
        </div>
      </div>
    </div>
  );
}

interface ChainDetailRobustnessActionProps {
  canCompute: boolean;
  computing: boolean;
  generatedRobustnessId: string | null;
  error: string | null;
  scenarioKind: ChainDetailRobustnessScenarioKind;
  scenarioOptions: ChainDetailRobustnessScenarioOption[];
  unavailableScenarios: ChainDetailRobustnessUnavailableScenario[];
  severity: string;
  distribution: RobustnessScenarioDistribution;
  distributionOptions: RobustnessScenarioDistributionOption[];
  evidence: PredictionRobustnessEvidenceResponse | null;
  loadingEvidence: boolean;
  validationError: string | null;
  onCompute: () => void;
  onScenarioKindChange: (kind: ChainDetailRobustnessScenarioKind) => void;
  onSeverityChange: (severity: string) => void;
  onDistributionChange: (distribution: RobustnessScenarioDistribution) => void;
}

function robustnessExportFilename(robustnessId: string, extension: string): string {
  const stem = robustnessId.trim().replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "")
    || "robustness-report";
  return `${stem}.${extension}`;
}

function exportErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object" && "detail" in error) {
    const detail = (error as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) return detail;
  }
  return "Failed to export robustness report.";
}

function ChainDetailRobustnessAction({
  canCompute,
  computing,
  generatedRobustnessId,
  error,
  scenarioKind,
  scenarioOptions,
  unavailableScenarios,
  severity,
  distribution,
  distributionOptions,
  evidence,
  loadingEvidence,
  validationError,
  onCompute,
  onScenarioKindChange,
  onSeverityChange,
  onDistributionChange,
}: ChainDetailRobustnessActionProps) {
  const selectedOption = scenarioOptions.find((option) => option.kind === scenarioKind)
    ?? scenarioOptions[0];
  const selectedScenarioUsesSpectralReplay = selectedOption?.requiresExplicitPredictor === true;
  const enabledDistributionOptions = distributionOptions.filter((option) => !option.disabled);
  const showDistributionSelect = enabledDistributionOptions.length > 0;
  const [exportingFormat, setExportingFormat] = useState<RobustnessReportExportFormat | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExport = async (format: RobustnessReportExportFormat, extension: string) => {
    if (!generatedRobustnessId || exportingFormat) return;
    setExportingFormat(format);
    setExportError(null);
    try {
      const blob = await exportWorkspaceRobustnessReport(generatedRobustnessId, format);
      downloadBlob(blob, robustnessExportFilename(generatedRobustnessId, extension));
    } catch (error) {
      setExportError(exportErrorMessage(error));
    } finally {
      setExportingFormat(null);
    }
  };

  return (
    <div className="rounded-lg border border-border/70 bg-background/70 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-medium">Native robustness report</h4>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Compute an audit-only robustness report from the selected stored prediction evidence. This calls nirs4all
            and persists a `RobustnessReport`; Studio does not synthesize missing truth labels or replay spectral
            perturbations locally.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px_140px]">
            <label className="grid gap-1 text-[11px] text-muted-foreground">
              Scenario
              <select
                className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                disabled={computing}
                value={scenarioKind}
                onChange={(event) => onScenarioKindChange(event.target.value as ChainDetailRobustnessScenarioKind)}
              >
                {scenarioOptions.map((option) => (
                  <option key={option.kind} value={option.kind}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-[11px] text-muted-foreground">
              {selectedOption?.severityLabel ?? "Severity"}
              <input
                className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground disabled:opacity-60"
                disabled={computing || scenarioKind === "observed"}
                inputMode="decimal"
                type="number"
                step="0.01"
                value={scenarioKind === "observed" ? "0" : severity}
                onChange={(event) => onSeverityChange(event.target.value)}
              />
            </label>
            {showDistributionSelect && (
              <label className="grid gap-1 text-[11px] text-muted-foreground">
                Distribution
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                  disabled={computing}
                  value={distribution}
                  onChange={(event) => onDistributionChange(event.target.value as RobustnessScenarioDistribution)}
                >
                  {enabledDistributionOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {selectedOption?.description ?? "Stored-prediction robustness scenario."}{" "}
            {showDistributionSelect
              ? distribution === "uniform"
                ? "Uniform uses bounded centered noise in [-severity, +severity]. "
                : "Normal uses seeded Gaussian noise with severity as sigma. "
              : ""}
            {selectedScenarioUsesSpectralReplay
              ? "This scenario is available because the selected prediction evidence includes row-aligned X/spectra and a saved predictor bundle/path."
              : "Spectral perturbations stay unavailable until row-aligned X/spectra and a frozen saved predictor bundle/path are present."}
          </p>
          <RobustnessEvidencePreflightCard evidence={evidence} loading={loadingEvidence} />
          {unavailableScenarios.length > 0 && (
            <details className="mt-2 rounded-md border border-dashed border-border/70 bg-muted/30 px-2 py-1.5 text-[11px] text-muted-foreground">
              <summary className="cursor-pointer text-foreground">
                Unavailable from stored predictions ({unavailableScenarios.length})
              </summary>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {unavailableScenarios.map((scenario) => (
                  <li key={scenario.kind}>
                    <span className="font-medium text-foreground">{scenario.label}</span>: {scenario.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {generatedRobustnessId && (
            <div className="mt-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-1.5">
              <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                Report persisted: <code>{generatedRobustnessId}</code>
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {ROBUSTNESS_REPORT_EXPORTS.map((exportTarget) => (
                  <Button
                    key={exportTarget.format}
                    disabled={!!exportingFormat}
                    onClick={() => void handleExport(exportTarget.format, exportTarget.extension)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {exportingFormat === exportTarget.format ? "Exporting..." : exportTarget.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {exportError && (
            <p className="mt-1 text-[11px] text-destructive">{exportError}</p>
          )}
          {validationError && (
            <p className="mt-1 text-[11px] text-destructive">{validationError}</p>
          )}
          {error && (
            <p className="mt-1 text-[11px] text-destructive">{error}</p>
          )}
        </div>
        <Button
          className="shrink-0"
          disabled={!canCompute}
          onClick={onCompute}
          size="sm"
          variant="outline"
        >
          {computing ? "Computing..." : "Compute report"}
        </Button>
      </div>
    </div>
  );
}
