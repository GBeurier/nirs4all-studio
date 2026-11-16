import { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { WaterfallChart as WaterfallView, signedNumber } from 'nirs4all-ui/viz';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getSampleExplanation } from '@/api/shap';
import { ChartScrollRegion } from './ChartScrollRegion';
import {
  buildShapWaterfallContributions,
  formatShapWaterfallValue,
  getShapWaterfallNextSample,
  getShapWaterfallPreviousSample,
  parseShapWaterfallSampleInput,
} from '@/lib/shapWaterfallData';
import type { SampleExplanationResponse } from '@/types/shap';

interface WaterfallChartProps {
  jobId: string;
  sampleIdx: number;
  totalSamples: number;
  onSampleChange: (idx: number) => void;
}

export function WaterfallChart({
  jobId,
  sampleIdx,
  totalSamples,
  onSampleChange,
}: WaterfallChartProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<SampleExplanationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getSampleExplanation(jobId, sampleIdx, 12)
      .then((response) => {
        if (cancelled) return;
        setData(response);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || t('results.variableImportance.waterfall.loadFailed'));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [jobId, sampleIdx, t]);

  const contributions = useMemo(() => (data ? buildShapWaterfallContributions(data) : []), [data]);
  const rows = useMemo(() => {
    let running = data?.base_value ?? 0;
    return contributions.map((contribution) => {
      running += contribution.value;
      return { ...contribution, runningTotal: running };
    });
  }, [contributions, data]);

  const handlePrevSample = () => {
    const previousSample = getShapWaterfallPreviousSample(sampleIdx);
    if (previousSample != null) onSampleChange(previousSample);
  };

  const handleNextSample = () => {
    const nextSample = getShapWaterfallNextSample(sampleIdx, totalSamples);
    if (nextSample != null) onSampleChange(nextSample);
  };

  const sampleSelector = (
    <div className="flex items-center gap-2">
      <Label htmlFor="shap-waterfall-sample" className="text-sm">{t('results.variableImportance.waterfall.sampleLabel')}</Label>
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        onClick={handlePrevSample}
        disabled={sampleIdx === 0}
        aria-label={t('results.variableImportance.waterfall.previousSample')}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Input
        id="shap-waterfall-sample"
        type="number"
        value={sampleIdx}
        onChange={(e) => {
          const nextSample = parseShapWaterfallSampleInput(e.target.value, totalSamples);
          if (nextSample != null) onSampleChange(nextSample);
        }}
        className="w-20 h-8 text-center"
        min={0}
        max={totalSamples - 1}
      />
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        onClick={handleNextSample}
        disabled={sampleIdx === totalSamples - 1}
        aria-label={t('results.variableImportance.waterfall.nextSample')}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      <span className="text-sm text-muted-foreground">{t('results.variableImportance.waterfall.ofTotal', { total: totalSamples })}</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {/* The selector stays mounted while a sample loads so keyboard focus is kept during navigation. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {sampleSelector}
        {data && !loading && !error && (
          <div className="text-sm">
            <span className="text-muted-foreground">{t('results.variableImportance.waterfall.predicted')} </span>
            <span className="font-mono font-medium">{formatShapWaterfallValue(data.predicted_value)}</span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="h-[360px] flex items-center justify-center" role="status">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-label={t('common.loading')} />
        </div>
      ) : error ? (
        <div className="h-[360px] flex items-center justify-center text-destructive" role="alert">
          {error}
        </div>
      ) : !data ? (
        <div className="h-[360px] flex items-center justify-center text-muted-foreground">
          {t('results.variableImportance.waterfall.noData')}
        </div>
      ) : (
        <>
          <ChartScrollRegion label={t('results.variableImportance.waterfall.title')}>
            {(width) => (
              <WaterfallView
                baseValue={data.base_value}
                predicted={data.predicted_value}
                contributions={contributions}
                topN={contributions.length}
                valueFormat={formatShapWaterfallValue}
                title={t('results.variableImportance.waterfall.title')}
                xLabel={t('results.variableImportance.waterfall.modelOutput')}
                width={width}
              />
            )}
          </ChartScrollRegion>
          <p className="text-xs text-muted-foreground">{t('results.variableImportance.waterfall.note')}</p>
          <details className="text-sm">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              {t('results.variableImportance.waterfall.tableSummary')}
            </summary>
            <div className="mt-2 max-h-[220px] overflow-auto rounded-md border" role="region" tabIndex={0} aria-label={t('results.variableImportance.waterfall.tableSummary')}>
              <table className="w-full text-xs">
                <caption className="sr-only">{t('results.variableImportance.waterfall.tableSummary')}</caption>
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th scope="col" className="px-2 py-1 text-left font-medium">{t('results.variableImportance.waterfall.region')}</th>
                    <th scope="col" className="px-2 py-1 text-right font-medium">{t('results.variableImportance.waterfall.contribution')}</th>
                    <th scope="col" className="px-2 py-1 text-right font-medium">{t('results.variableImportance.waterfall.runningTotal')}</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  <tr className="border-b">
                    <th scope="row" className="px-2 py-1 text-left font-normal">{t('results.variableImportance.waterfall.baseValue')}</th>
                    <td className="px-2 py-1 text-right">—</td>
                    <td className="px-2 py-1 text-right">{formatShapWaterfallValue(data.base_value)}</td>
                  </tr>
                  {rows.map((row) => (
                    <tr key={row.label} className="border-b last:border-0">
                      <th scope="row" className="px-2 py-1 text-left font-normal">{row.label}</th>
                      <td className="px-2 py-1 text-right">{signedNumber(row.value, formatShapWaterfallValue)}</td>
                      <td className="px-2 py-1 text-right">{formatShapWaterfallValue(row.runningTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
