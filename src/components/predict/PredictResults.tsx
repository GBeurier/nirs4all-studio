import { useEffect, useMemo, useRef, useState } from "react";

import { useDatasetsQuery } from "@/hooks/useDatasetQueries";
import { exportDataAsCSV } from "@/lib/chartExport";
import { Card } from "@/components/ui/card";

import {
  exportChartPng,
  exportRowsCsv,
  resolveExportBackground,
} from "@/components/predictions/viewer/export";
import { usePredictionChartConfig } from "@/components/predictions/viewer/usePredictionChartConfig";

import type { AvailableModel, PredictResponse } from "@/types/predict";

import type { PanelKind } from "./PredictChartPanel";
import {
  PredictFullscreenChartDialog,
  PredictResultsBody,
  PredictResultsHeader,
} from "./PredictResultsSections";
import {
  buildPredictAvailableKinds,
  buildPredictChartBaseFilename,
  buildPredictChartCsvExport,
  buildPredictFullscreenSubtitleParts,
  buildPredictFullscreenTitle,
  buildPredictMetricCards,
  buildPredictMetricEntries,
  buildPredictPartitionDatasets,
  buildPredictPreprocessingBadges,
  buildPredictReferenceBadge,
  buildPredictStatsCards,
  buildPredictSummaryCards,
  buildPredictTableCsvRows,
  buildPredictTableRows,
  buildPredictTaskBadge,
  buildPredictViewerHeader,
  computePredictStats,
  detectPredictTaskKind,
  getPredictInputLabel,
  getPredictInputSubLabel,
  resolvePredictInputFromDatasetCache,
  resolvePredictDefaultKind,
  type PredictionInput,
} from "./predictResultsData";

export type { PredictionInput } from "./predictResultsData";

interface PredictResultsProps {
  result: PredictResponse;
  model?: AvailableModel | null;
  input?: PredictionInput | null;
  onReset: () => void;
}

export function PredictResults({ result, model, input, onReset }: PredictResultsProps) {
  const { data: datasetsData } = useDatasetsQuery();

  const resolvedInput = useMemo<PredictionInput | null>(() => {
    return resolvePredictInputFromDatasetCache(input, datasetsData?.datasets);
  }, [input, datasetsData]);

  const hasActuals = result.actual_values != null && result.actual_values.length > 0;
  const hasMetrics = result.metrics != null;

  const taskKind = useMemo(
    () => detectPredictTaskKind({
      actualValues: result.actual_values,
      metrics: result.metrics,
      model,
      predictions: result.predictions,
    }),
    [result.metrics, result.actual_values, result.predictions, model],
  );

  const fallbackPartition =
    resolvedInput?.type === "dataset" ? resolvedInput.partition : hasActuals ? "test" : "pred";

  const partitionDatasets = useMemo(
    () => buildPredictPartitionDatasets({
      fallbackPartition,
      hasActuals,
      result,
    }),
    [result, hasActuals, fallbackPartition],
  );

  const displayName = getPredictInputLabel(resolvedInput, model?.dataset_name ?? "Prediction input");
  const displaySubLabel = getPredictInputSubLabel(resolvedInput) ?? null;

  const header = useMemo(
    () => buildPredictViewerHeader({ displayName, result, taskKind }),
    [displayName, result, taskKind],
  );

  const availableKinds = useMemo<PanelKind[]>(
    () => buildPredictAvailableKinds(hasActuals, taskKind),
    [hasActuals, taskKind],
  );

  const [kind, setKind] = useState<PanelKind>(() =>
    resolvePredictDefaultKind(availableKinds, taskKind, hasActuals),
  );
  const [expanded, setExpanded] = useState(false);

  // Reset the selected view whenever the underlying result makes the current
  // kind unavailable (e.g. switching from a classification result to a
  // regression one, or back to a no-actuals run).
  useEffect(() => {
    if (!availableKinds.includes(kind)) {
      setKind(resolvePredictDefaultKind(availableKinds, taskKind, hasActuals));
    }
  }, [availableKinds, hasActuals, kind, taskKind]);

  const configDatasetKey = useMemo(
    () => `predict::${result.model_name}`,
    [result.model_name],
  );
  const [config, setConfig, resetConfig] = usePredictionChartConfig({
    datasetKey: configDatasetKey,
  });

  const inlineChartRef = useRef<HTMLDivElement>(null);
  const fullscreenChartRef = useRef<HTMLDivElement>(null);

  const tableData = useMemo(
    () => buildPredictTableRows(result, hasActuals),
    [hasActuals, result],
  );

  const showPartitionColumn = tableData.some((row) => row.partition);

  const metricEntries = useMemo(
    () => buildPredictMetricEntries(result.metrics),
    [result.metrics],
  );

  const summaryMetric = metricEntries[0] ?? null;
  const predictionStats = useMemo(() => computePredictStats(result.predictions), [result.predictions]);
  const summaryCards = useMemo(
    () =>
      buildPredictSummaryCards({
        hasActuals,
        numSamples: result.num_samples,
        partitionCount: partitionDatasets.length,
        summaryMetric,
      }),
    [hasActuals, partitionDatasets.length, result.num_samples, summaryMetric],
  );
  const metricCards = useMemo(
    () => buildPredictMetricCards(metricEntries),
    [metricEntries],
  );
  const statsCards = useMemo(
    () => buildPredictStatsCards(predictionStats),
    [predictionStats],
  );
  const preprocessingBadges = useMemo(
    () => buildPredictPreprocessingBadges(result.preprocessing_steps),
    [result.preprocessing_steps],
  );
  const taskBadge = useMemo(() => buildPredictTaskBadge(taskKind), [taskKind]);
  const referenceBadge = useMemo(
    () => buildPredictReferenceBadge(hasActuals),
    [hasActuals],
  );
  const fullscreenTitle = useMemo(
    () => buildPredictFullscreenTitle({ displayName, modelName: result.model_name }),
    [displayName, result.model_name],
  );
  const fullscreenSubtitleParts = useMemo(
    () =>
      buildPredictFullscreenSubtitleParts({
        displaySubLabel,
        nSamples: result.num_samples,
        preprocessings: header.preprocessings ?? null,
      }),
    [displaySubLabel, header.preprocessings, result.num_samples],
  );

  const handleExportTableCsv = () => {
    exportDataAsCSV(buildPredictTableCsvRows(tableData), `predictions_${result.model_name}`);
  };

  const baseFilename = useMemo(
    () => buildPredictChartBaseFilename(displayName, result.model_name, kind),
    [displayName, result.model_name, kind],
  );

  const handleExportPng = (container: HTMLElement | null) => {
    const bg = resolveExportBackground(config.exportTheme);
    exportChartPng(container, `${baseFilename}.png`, bg);
  };

  const handleExportChartCsv = () => {
    const csvExport = buildPredictChartCsvExport({
      hasActuals,
      kind,
      partitionDatasets,
      predictions: result.predictions,
      sampleIds: result.sample_ids,
      taskKind,
    });
    exportRowsCsv(csvExport.rows, csvExport.columns, `${baseFilename}.csv`);
  };

  return (
    <>
      <Card className="border-border/60 shadow-sm">
        <PredictResultsHeader
          displayName={displayName}
          displaySubLabel={displaySubLabel}
          input={resolvedInput}
          modelName={result.model_name}
          numSamples={result.num_samples}
          onExportTableCsv={handleExportTableCsv}
          onReset={onReset}
          preprocessingBadges={preprocessingBadges}
          referenceBadge={referenceBadge}
          summaryCards={summaryCards}
          taskBadge={taskBadge}
        />

        <PredictResultsBody
          availableKinds={availableKinds}
          chartRef={inlineChartRef}
          config={config}
          datasets={partitionDatasets}
          hasActuals={hasActuals}
          hasMetrics={hasMetrics}
          kind={kind}
          metricCards={metricCards}
          onConfigChange={setConfig}
          onConfigReset={resetConfig}
          onExportChartCsv={handleExportChartCsv}
          onExportPng={handleExportPng}
          onKindChange={setKind}
          onOpenFullscreen={() => setExpanded(true)}
          rows={tableData}
          showPartitionColumn={showPartitionColumn}
          statsCards={statsCards}
          taskKind={taskKind}
        />
      </Card>

      <PredictFullscreenChartDialog
        availableKinds={availableKinds}
        chartRef={fullscreenChartRef}
        config={config}
        datasets={partitionDatasets}
        hasActuals={hasActuals}
        kind={kind}
        onConfigChange={setConfig}
        onConfigReset={resetConfig}
        onExportChartCsv={handleExportChartCsv}
        onExportPng={handleExportPng}
        onKindChange={setKind}
        onOpenChange={setExpanded}
        open={expanded}
        subtitleParts={fullscreenSubtitleParts}
        taskBadge={taskBadge}
        taskKind={taskKind}
        title={fullscreenTitle}
      />
    </>
  );
}
