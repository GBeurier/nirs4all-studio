/**
 * SpectraChartExportActions - Export action handlers for SpectraChart.
 *
 * Owns the two CSV/PNG export callbacks (full view + selected samples) so the
 * `SpectraChart` orchestrator no longer mixes export wiring with selection and
 * render concerns. Behaviour is identical to the previous inline callbacks: the
 * same export rows are built and the same `chartRef` element is captured.
 */

import { useCallback, type RefObject } from 'react';

import { exportChart } from '@/lib/chartExport';
import { buildSpectraExportRows } from '@/lib/playground/spectraChartData';

interface SpectraExportFocusedData {
  wavelengths: number[];
  spectra: number[][];
}

export interface UseSpectraChartExportActionsParams {
  /** Ref to the chart container captured for export. */
  chartRef: RefObject<HTMLDivElement | null>;
  /** Focused wavelengths/spectra currently displayed. */
  focusedData: SpectraExportFocusedData;
  /** Indices of the samples currently displayed (export-all order). */
  displayIndices: number[];
  /** Optional sample identifiers used as column headers. */
  sampleIds?: string[];
}

export interface SpectraChartExportActions {
  /** Export every currently displayed sample. */
  handleExport: () => void;
  /** Export an explicit subset of samples (context-menu action). */
  handleExportSamples: (sampleIndices: number[]) => void;
}

export function useSpectraChartExportActions({
  chartRef,
  focusedData,
  displayIndices,
  sampleIds,
}: UseSpectraChartExportActionsParams): SpectraChartExportActions {
  // Export the full displayed view.
  const handleExport = useCallback(() => {
    const exportData = buildSpectraExportRows({
      wavelengths: focusedData.wavelengths,
      spectra: focusedData.spectra,
      sampleIndices: displayIndices,
      sampleIds,
    });
    exportChart(chartRef.current, exportData, 'spectra');
  }, [chartRef, focusedData, displayIndices, sampleIds]);

  // Context menu: export an explicit subset of samples.
  const handleExportSamples = useCallback((sampleIndices: number[]) => {
    const exportData = buildSpectraExportRows({
      wavelengths: focusedData.wavelengths,
      spectra: focusedData.spectra,
      sampleIndices,
      sampleIds,
    });
    exportChart(chartRef.current, exportData, `spectra_${sampleIndices.length}samples`);
  }, [chartRef, focusedData, sampleIds]);

  return { handleExport, handleExportSamples };
}
