import { useMemo, useEffect, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { SpectralImportanceChart as SpectralImportanceView } from 'nirs4all-ui/viz';
import { getSpectralDetail } from '@/api/shap';
import { ChartScrollRegion } from './ChartScrollRegion';
import { getShapAxisDisplay } from '@/lib/shapAxisDisplay';
import { formatWavelengthUnit } from '@/components/playground/visualizations/chartConfig';
import {
  buildShapSpectralRegions,
  getShapBinValueKind,
  hasShapSpectralAbsorbance,
} from '@/lib/shapSpectralImportanceData';
import { normalizeShapBinAggregation } from '@/lib/shapBinningControlsData';
import type { ShapResultsResponse, BinnedImportanceData } from '@/types/shap';

interface SpectralImportanceChartProps {
  jobId: string;
  results: ShapResultsResponse;
  binnedData?: BinnedImportanceData;
  selectedSamples?: number[];
}

export const SpectralImportanceChart = memo(function SpectralImportanceChart({
  jobId,
  results,
  binnedData,
  selectedSamples,
}: SpectralImportanceChartProps) {
  const { t } = useTranslation();
  const axis = getShapAxisDisplay(results.axis_unit, t);
  const axisUnit = formatWavelengthUnit(results.axis_unit) || undefined;
  const [filteredShap, setFilteredShap] = useState<number[] | null>(null);
  const [filteredSpectrum, setFilteredSpectrum] = useState<number[] | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Debounced fetch of sample-filtered spectral detail (300ms)
  useEffect(() => {
    let cancelled = false;
    setFilteredShap(null);
    setFilteredSpectrum(null);
    setDetailError(null);
    if (!selectedSamples || selectedSamples.length === 0) {
      setLoadingDetail(false);
      return;
    }

    setLoadingDetail(true);
    const timer = setTimeout(() => {
      getSpectralDetail(jobId, selectedSamples)
        .then((detail) => {
          if (cancelled) return;
          setFilteredShap(detail.mean_abs_shap);
          setFilteredSpectrum(detail.mean_spectrum);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setDetailError(error instanceof Error ? error.message : t('results.variableImportance.job.fetchFailed'));
        })
        .finally(() => { if (!cancelled) setLoadingDetail(false); });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId, selectedSamples, t]);

  const activeBinned = binnedData || results.binned_importance;
  const isFiltered = Boolean(filteredShap);
  const activeShap = filteredShap || results.mean_abs_shap;
  const activeSpectrum = filteredSpectrum || results.mean_spectrum;
  const aggregation = normalizeShapBinAggregation(activeBinned.aggregation);
  const regionLabel = t(`results.variableImportance.spectral.region.${aggregation}`);

  const regions = useMemo(() => buildShapSpectralRegions(activeBinned), [activeBinned]);
  const hasSpectrum = hasShapSpectralAbsorbance(activeSpectrum);

  return (
    <div className="flex flex-col gap-2">
      {(loadingDetail || isFiltered) && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          {loadingDetail && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
          {isFiltered && !loadingDetail && (
            <span>{t('results.variableImportance.spectral.showing', { count: selectedSamples?.length ?? 0 })}</span>
          )}
          {loadingDetail && <span>{t('results.variableImportance.spectral.loadingDetail')}</span>}
        </div>
      )}
      {detailError && <p className="text-xs text-destructive" role="alert">{detailError}</p>}

      <ChartScrollRegion label={t('results.variableImportance.spectral.title')}>
        {(width) => (
          <SpectralImportanceView
            axis={results.wavelengths}
            importance={activeShap}
            spectrum={hasSpectrum ? activeSpectrum : undefined}
            regions={regions}
            regionValueKind={getShapBinValueKind(aggregation)}
            axisLabel={axis.label}
            axisUnit={axisUnit}
            importanceLabel={t(isFiltered ? 'results.variableImportance.spectral.curveSelected' : 'results.variableImportance.spectral.curve')}
            spectrumLabel={t(isFiltered ? 'results.variableImportance.spectral.meanSpectrumSelected' : 'results.variableImportance.spectral.meanSpectrum')}
            regionLabel={regionLabel}
            positiveLabel={t('results.variableImportance.spectral.raises')}
            negativeLabel={t('results.variableImportance.spectral.lowers')}
            instructions={t('results.variableImportance.spectral.instructions')}
            title={t('results.variableImportance.spectral.title')}
            width={width}
            height={Math.round(Math.min(480, Math.max(340, width * 0.52)))}
          />
        )}
      </ChartScrollRegion>
      <p className="text-xs text-muted-foreground">
        {t('results.variableImportance.spectral.note', { region: regionLabel })}
      </p>
    </div>
  );
});
