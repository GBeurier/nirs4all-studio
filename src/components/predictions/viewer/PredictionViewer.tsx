/**
 * Unified prediction chart viewer (modal shell).
 *
 * Layout top→bottom:
 *   header / toolbar (kind switcher + partitions) / secondary toolbar
 *   (gear + exports) / chart area / metrics strip.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { PredictionColorLegend } from "./PredictionColorLegend";
import { MetricsStrip } from "./MetricsStrip";
import { PredictionViewerChartArea } from "./PredictionViewerChartArea";
import { PredictionViewerExportToolbar } from "./PredictionViewerExportToolbar";
import { PredictionViewerHeader } from "./PredictionViewerHeader";
import { PredictionViewerKindToolbar } from "./PredictionViewerKindToolbar";
import { usePredictionChartConfig } from "./usePredictionChartConfig";
import { usePartitionsData } from "./fetchPartitionData";
import { buildPredictionColoration } from "./coloration";
import {
  exportChartPng,
  exportRowsCsv,
  resolveExportBackground,
} from "./export";
import {
  buildPredictionViewerBaseFilename,
  buildPredictionViewerCsvExport,
  buildPredictionViewerHeaderDescription,
  buildPredictionViewerHeaderTitle,
  getPredictionViewerAvailableKinds,
  getPredictionViewerTaskKind,
  resolvePredictionViewerInitialKind,
  shouldShowPredictionColorLegend,
} from "./predictionViewerData";
import type { ChartKind, PredictionViewerProps, TaskKind } from "./types";

export function PredictionViewer({
  open,
  onOpenChange,
  header,
  partitions,
  workspaceId,
  initialKind,
}: PredictionViewerProps) {
  const configDatasetKey = useMemo(
    () => `${workspaceId ?? "__current__"}::${header.datasetName}`,
    [workspaceId, header.datasetName],
  );
  const [config, setConfig, resetConfig] = usePredictionChartConfig({ datasetKey: configDatasetKey });

  const taskKind: TaskKind = useMemo(
    () => getPredictionViewerTaskKind(header.taskType),
    [header.taskType],
  );

  const [kind, setKind] = useState<ChartKind>(() => resolvePredictionViewerInitialKind(initialKind, taskKind));
  const [visible, setVisible] = useState<Set<string>>(() =>
    new Set(partitions.map((p) => p.partition)),
  );

  // Reset kind / visible when viewer opens or when inputs change.
  useEffect(() => {
    if (!open) return;
    setKind(resolvePredictionViewerInitialKind(initialKind, taskKind));
  }, [open, initialKind, taskKind]);

  useEffect(() => {
    setVisible(new Set(partitions.map((p) => p.partition)));
  }, [partitions]);

  const { data: allDatasets, isLoading, error } = usePartitionsData({
    partitions,
    workspaceId,
    enabled: open && partitions.length > 0,
  });

  const visibleDatasets = useMemo(
    () => allDatasets.filter((d) => visible.has(d.partition)),
    [allDatasets, visible],
  );
  const coloration = useMemo(
    () => buildPredictionColoration(allDatasets, config),
    [allDatasets, config],
  );

  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || config.colorMode !== "metadata") return;
    if (coloration.metadataColumns.length === 0) return;
    if (config.metadataKey && coloration.metadataColumns.includes(config.metadataKey)) return;
    setConfig((prev) => ({
      ...prev,
      metadataKey: coloration.metadataColumns[0],
      metadataType: undefined,
    }));
  }, [open, config.colorMode, config.metadataKey, coloration.metadataColumns, setConfig]);

  const baseFilename = buildPredictionViewerBaseFilename(header, kind);

  const handleExportPng = () => {
    if (!chartRef.current) return;
    const bg = resolveExportBackground(config.exportTheme);
    exportChartPng(chartRef.current, `${baseFilename}.png`, bg);
  };

  const handleExportCsv = () => {
    const csvExport = buildPredictionViewerCsvExport(kind, visibleDatasets, config);
    if (!csvExport) return;
    exportRowsCsv(csvExport.rows, csvExport.columns, `${baseFilename}.csv`);
  };

  const toggleVisible = (partition: string) => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(partition)) next.delete(partition);
      else next.add(partition);
      return next;
    });
  };

  const headerTitle = useMemo(() => buildPredictionViewerHeaderTitle(header), [header]);
  const headerDescription = useMemo(() => buildPredictionViewerHeaderDescription(header), [header]);

  const availableKinds = useMemo(() => getPredictionViewerAvailableKinds(taskKind), [taskKind]);
  const legendVisible = shouldShowPredictionColorLegend({
    colorMode: config.colorMode,
    datasetCount: visibleDatasets.length,
    kind,
    metadataKey: coloration.metadataKey,
  });

  const hasActuals = useMemo(
    () => allDatasets.some((d) => d.yTrue.some((v) => Number.isFinite(v))),
    [allDatasets],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-[90vw] h-[85vh] p-0 flex flex-col">
        <PredictionViewerHeader
          description={headerDescription}
          header={header}
          title={headerTitle}
        />

        <PredictionViewerKindToolbar
          availableKinds={availableKinds}
          colors={config.partitionColors}
          kind={kind}
          onKindChange={setKind}
          onTogglePartition={toggleVisible}
          palette={config.palette}
          partitions={partitions}
          visible={visible}
        />

        <PredictionViewerExportToolbar
          canExport={visibleDatasets.length > 0}
          config={config}
          kind={kind}
          metadataColumns={coloration.metadataColumns}
          onChangeConfig={setConfig}
          onExportCsv={handleExportCsv}
          onExportPng={handleExportPng}
          onResetConfig={resetConfig}
          resolvedMetadataType={coloration.metadataType}
        />

        {legendVisible && (
          <div className="border-b px-5 py-2">
            <PredictionColorLegend datasets={visibleDatasets} config={config} />
          </div>
        )}

        <PredictionViewerChartArea
          chartRef={chartRef}
          config={config}
          datasets={visibleDatasets}
          error={error}
          hasActuals={hasActuals}
          isLoading={isLoading}
          kind={kind}
          taskKind={taskKind}
        />

        <MetricsStrip taskKind={taskKind} datasets={visibleDatasets} />
      </DialogContent>
    </Dialog>
  );
}
