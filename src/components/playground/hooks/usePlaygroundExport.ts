/**
 * usePlaygroundExport - Export handlers for Playground charts
 *
 * Phase 1 Refactoring: Extract export logic from MainCanvas
 *
 * Features:
 * - Export individual charts to PNG
 * - Export spectra data to CSV
 * - Export selections to JSON
 * - Batch export all visible charts
 */

import { useCallback, type RefObject } from 'react';
import { toast } from 'sonner';
import {
  exportToPng,
  exportSpectraToCsv,
  exportSelectionsToJson,
  batchExport,
  exportCombinedReport,
  type ChartExportData,
  type CombinedReportOptions,
} from '@/lib/playground/export';
import type { SavedSelection } from '@/context/SelectionContext';
import type { ChartType } from '../CanvasToolbar';

// ============= Types =============

export interface ChartRefs {
  spectra: RefObject<HTMLDivElement | null>;
  histogram: RefObject<HTMLDivElement | null>;
  pca: RefObject<HTMLDivElement | null>;
  folds: RefObject<HTMLDivElement | null>;
  repetitions: RefObject<HTMLDivElement | null>;
}

export interface ExportData {
  spectra: number[][] | null;
  wavelengths: number[] | null;
  sampleIds?: string[];
  selectedSamples: Set<number>;
  pinnedSamples: Set<number>;
  /** Outlier indices for export (Phase 8) */
  outlierIndices?: Set<number>;
  /** Dataset name for combined report */
  datasetName?: string;
  /** Pipeline description for combined report */
  pipelineDescription?: string;
}

export interface UsePlaygroundExportOptions {
  chartRefs: ChartRefs;
  exportData: ExportData;
  visibleCharts: Set<ChartType>;
}

export interface UsePlaygroundExportResult {
  /** Export a single chart to PNG */
  exportChartPng: (chartType: ChartType) => Promise<void>;
  /** Export spectra data to CSV */
  exportSpectraCsv: () => Promise<void>;
  /** Export current selection to JSON */
  exportSelectionsJson: () => Promise<void>;
  /** Export all visible charts to PNG */
  batchExportCharts: () => Promise<void>;
  /** Export combined report with all charts (Phase 8) */
  exportCombinedReportPng: () => Promise<void>;
}

// ============= Hook =============

export function usePlaygroundExport({
  chartRefs,
  exportData,
  visibleCharts,
}: UsePlaygroundExportOptions): UsePlaygroundExportResult {
  // Export a single chart to PNG
  const exportChartPng = useCallback(async (chartType: ChartType) => {
    const ref = chartRefs[chartType];
    if (!ref?.current) {
      toast.error('Chart not available');
      return;
    }

    try {
      const chartData: ChartExportData = {
        chartType,
        element: ref.current,
      };
      const result = await exportToPng(chartData, { filename: `${chartType}-chart` });
      if (result.success) {
        toast.success('Chart exported', { description: `${chartType}.png saved` });
      } else {
        toast.error('Export failed', { description: result.error });
      }
    } catch (error) {
      toast.error('Export failed', { description: (error as Error).message });
    }
  }, [chartRefs]);

  // Export spectra data to CSV (Phase 8: includes outlier column)
  const exportSpectraCsv = useCallback(async () => {
    const { spectra, wavelengths, sampleIds, outlierIndices } = exportData;

    if (!spectra || !wavelengths) {
      toast.error('No spectra data to export');
      return;
    }

    try {
      const result = exportSpectraToCsv(
        { spectra, wavelengths, sampleIds, outlierIndices },
        { filename: 'processed-spectra' }
      );
      if (result.success) {
        const outlierInfo = outlierIndices?.size ? ` (${outlierIndices.size} outliers marked)` : '';
        toast.success('Data exported', {
          description: `${spectra.length} samples × ${wavelengths.length} wavelengths saved to CSV${outlierInfo}`,
        });
      } else {
        toast.error('Export failed', { description: result.error });
      }
    } catch (error) {
      toast.error('Export failed', { description: (error as Error).message });
    }
  }, [exportData]);

  // Export current selection to JSON
  const exportSelectionsJson = useCallback(async () => {
    const { selectedSamples, pinnedSamples } = exportData;

    // Convert sets to SavedSelection format
    const selections: SavedSelection[] = [];

    if (selectedSamples.size > 0) {
      selections.push({
        id: `current-selection-${Date.now()}`,
        name: 'Current Selection',
        indices: Array.from(selectedSamples),
        color: '#3b82f6',
        createdAt: new Date(),
      });
    }

    if (pinnedSamples.size > 0) {
      selections.push({
        id: `pinned-samples-${Date.now()}`,
        name: 'Pinned Samples',
        indices: Array.from(pinnedSamples),
        color: '#eab308',
        createdAt: new Date(),
      });
    }

    if (selections.length === 0) {
      toast.error('No selections to export');
      return;
    }

    try {
      const result = exportSelectionsToJson(selections, { filename: 'playground-selections' });
      if (result.success) {
        toast.success('Selections exported', {
          description: `${selectedSamples.size} selected, ${pinnedSamples.size} pinned samples saved`,
        });
      } else {
        toast.error('Export failed', { description: result.error });
      }
    } catch (error) {
      toast.error('Export failed', { description: (error as Error).message });
    }
  }, [exportData]);

  // Batch export all visible charts
  const batchExportCharts = useCallback(async () => {
    const charts = new Map<string, ChartExportData>();

    if (chartRefs.spectra.current && visibleCharts.has('spectra')) {
      charts.set('spectra', {
        chartType: 'spectra',
        element: chartRefs.spectra.current,
      });
    }
    if (chartRefs.histogram.current && visibleCharts.has('histogram')) {
      charts.set('histogram', {
        chartType: 'histogram',
        element: chartRefs.histogram.current,
      });
    }
    if (chartRefs.pca.current && visibleCharts.has('pca')) {
      charts.set('pca', {
        chartType: 'pca',
        element: chartRefs.pca.current,
      });
    }
    if (chartRefs.folds.current && visibleCharts.has('folds')) {
      charts.set('folds', {
        chartType: 'folds',
        element: chartRefs.folds.current,
      });
    }
    if (chartRefs.repetitions.current && visibleCharts.has('repetitions')) {
      charts.set('repetitions', {
        chartType: 'repetitions',
        element: chartRefs.repetitions.current,
      });
    }

    if (charts.size === 0) {
      toast.error('No charts to export');
      return;
    }

    try {
      const results = await batchExport({
        formats: ['png'],
        charts,
        filename: 'playground',
      });
      const successCount = results.filter(r => r.success).length;
      toast.success('Batch export complete', {
        description: `${successCount}/${charts.size} charts exported`,
      });
    } catch (error) {
      toast.error('Batch export failed', { description: (error as Error).message });
    }
  }, [chartRefs, visibleCharts]);

  // Export combined report with all charts (Phase 8)
  const exportCombinedReportPng = useCallback(async () => {
    const { spectra, wavelengths, selectedSamples, outlierIndices, datasetName, pipelineDescription } = exportData;
    const chartElements = new Map<string, HTMLElement>();

    // Collect visible chart elements
    if (chartRefs.spectra.current && visibleCharts.has('spectra')) {
      chartElements.set('spectra', chartRefs.spectra.current);
    }
    if (chartRefs.pca.current && visibleCharts.has('pca')) {
      chartElements.set('pca', chartRefs.pca.current);
    }
    if (chartRefs.histogram.current && visibleCharts.has('histogram')) {
      chartElements.set('histogram', chartRefs.histogram.current);
    }
    if (chartRefs.folds.current && visibleCharts.has('folds')) {
      chartElements.set('folds', chartRefs.folds.current);
    }
    if (chartRefs.repetitions.current && visibleCharts.has('repetitions')) {
      chartElements.set('repetitions', chartRefs.repetitions.current);
    }

    if (chartElements.size === 0) {
      toast.error('No charts to export');
      return;
    }

    // Build statistics
    const statistics: CombinedReportOptions['statistics'] = {
      sampleCount: spectra?.length,
      wavelengthCount: wavelengths?.length,
      selectedCount: selectedSamples.size,
      outlierCount: outlierIndices?.size ?? 0,
    };

    try {
      const result = await exportCombinedReport(chartElements, {
        filename: 'playground-report',
        datasetName: datasetName ?? 'Playground Data',
        pipelineDescription,
        statistics,
      });

      if (result.success) {
        toast.success('Combined report exported', {
          description: `Report with ${chartElements.size} charts saved to ${result.filename}`,
        });
      } else {
        toast.error('Export failed', { description: result.error });
      }
    } catch (error) {
      toast.error('Export failed', { description: (error as Error).message });
    }
  }, [chartRefs, visibleCharts, exportData]);

  return {
    exportChartPng,
    exportSpectraCsv,
    exportSelectionsJson,
    batchExportCharts,
    exportCombinedReportPng,
  };
}

export default usePlaygroundExport;
