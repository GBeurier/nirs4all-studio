import { useMemo, useRef } from 'react';

import { buildPlaygroundChartExportInput } from '@/lib/playground/chartInputs';
import type { ChartType } from '@/context/usePlaygroundView';
import type { PlaygroundDataViewProjection } from '@/lib/playground/dataViewProjection';
import type { PlaygroundResult } from '@/types/playground';
import type { SpectralData } from '@/types/spectral';
import {
  usePlaygroundExport,
  type ChartRefs,
  type UsePlaygroundExportResult,
} from './usePlaygroundExport';

export interface UseMainCanvasExportsOptions {
  rawData: SpectralData | null;
  result: PlaygroundResult | null;
  selectedSamples: Set<number>;
  pinnedSamples: Set<number>;
  outlierIndices?: number[];
  visibleCharts: Set<ChartType>;
  dataView?: PlaygroundDataViewProjection | null;
}

export interface UseMainCanvasExportsResult extends UsePlaygroundExportResult {
  chartRefs: ChartRefs;
}

export function useMainCanvasExports({
  rawData,
  result,
  selectedSamples,
  pinnedSamples,
  outlierIndices,
  visibleCharts,
  dataView,
}: UseMainCanvasExportsOptions): UseMainCanvasExportsResult {
  const spectraChartRef = useRef<HTMLDivElement>(null);
  const histogramChartRef = useRef<HTMLDivElement>(null);
  const pcaChartRef = useRef<HTMLDivElement>(null);
  const foldsChartRef = useRef<HTMLDivElement>(null);
  const repetitionsChartRef = useRef<HTMLDivElement>(null);

  const chartRefs: ChartRefs = useMemo(() => ({
    spectra: spectraChartRef,
    histogram: histogramChartRef,
    pca: pcaChartRef,
    folds: foldsChartRef,
    repetitions: repetitionsChartRef,
  }), []);

  const exportData = useMemo(() => buildPlaygroundChartExportInput({
    rawData,
    result,
    selectedSamples,
    pinnedSamples,
    outlierIndices,
    dataView,
  }), [rawData, result, selectedSamples, pinnedSamples, outlierIndices, dataView]);

  const exportActions = usePlaygroundExport({
    chartRefs,
    exportData,
    visibleCharts,
  });

  return {
    chartRefs,
    ...exportActions,
  };
}
