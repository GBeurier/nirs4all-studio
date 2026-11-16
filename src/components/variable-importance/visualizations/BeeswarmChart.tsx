import { useEffect, useId, useState, useMemo, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, X } from 'lucide-react';
import { ShapBeeswarm } from 'nirs4all-ui/viz';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getBeeswarmData } from '@/api/shap';
import { ChartScrollRegion } from './ChartScrollRegion';
import { getShapAxisDisplay } from '@/lib/shapAxisDisplay';
import { buildShapBeeswarmFeatures, SHAP_BEESWARM_DEFAULT_ROWS } from '@/lib/shapBeeswarmData';
import { parseShapWaterfallSampleInput } from '@/lib/shapWaterfallData';
import type { BeeswarmDataResponse } from '@/types/shap';

interface BeeswarmChartProps {
  jobId: string;
  totalSamples: number;
  onSampleSelect?: (sampleIdx: number) => void;
  onClearSelection?: () => void;
  selectedSamples?: number[];
}

export const BeeswarmChart = memo(function BeeswarmChart({
  jobId,
  totalSamples,
  onSampleSelect,
  onClearSelection,
  selectedSamples = [],
}: BeeswarmChartProps) {
  const { t } = useTranslation();
  const inputId = useId();
  const [data, setData] = useState<BeeswarmDataResponse | null>(null);
  const axis = getShapAxisDisplay(data?.axis_unit, t);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [sampleInput, setSampleInput] = useState('');

  useEffect(() => {
    setLoading(true);
    setError(null);
    getBeeswarmData(jobId, 200)
      .then((response) => {
        setData(response);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || t('results.variableImportance.beeswarm.loadFailed'));
        setLoading(false);
      });
  }, [jobId, t]);

  const totalRows = data?.bins.length ?? 0;
  const features = useMemo(() => {
    if (!data) return [];
    return buildShapBeeswarmFeatures(data.bins, showAll ? undefined : SHAP_BEESWARM_DEFAULT_ROWS);
  }, [data, showAll]);

  if (loading) {
    return (
      <div className="h-[360px] flex items-center justify-center" role="status">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-label={t('common.loading')} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-[360px] flex items-center justify-center text-destructive" role="alert">
        {error}
      </div>
    );
  }

  if (!data || data.bins.length === 0) {
    return (
      <div className="h-[360px] flex items-center justify-center text-muted-foreground">
        {t('results.variableImportance.beeswarm.noData')}
      </div>
    );
  }

  const toggleTyped = () => {
    const sample = parseShapWaterfallSampleInput(sampleInput, totalSamples);
    if (sample != null && onSampleSelect) onSampleSelect(sample);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {axis.label} · {t('results.variableImportance.beeswarm.rowsShown', { shown: features.length, total: totalRows })}
        </span>
        {totalRows > SHAP_BEESWARM_DEFAULT_ROWS && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowAll((value) => !value)}>
            {showAll
              ? t('results.variableImportance.beeswarm.showTop', { count: SHAP_BEESWARM_DEFAULT_ROWS })
              : t('results.variableImportance.beeswarm.showAll', { count: totalRows })}
          </Button>
        )}
      </div>

      <ChartScrollRegion label={t('results.variableImportance.beeswarm.title')}>
        {(width) => (
          <ShapBeeswarm
            features={features}
            width={width}
            title={t('results.variableImportance.beeswarm.title')}
            xLabel={t('results.variableImportance.beeswarm.shapAxis')}
            colorLabel={t('results.variableImportance.beeswarm.colorLabel')}
            selectedSampleIds={selectedSamples}
            onPointActivate={onSampleSelect ? (sampleId) => onSampleSelect(Number(sampleId)) : undefined}
            sampleLabel={(sampleId) => t('results.variableImportance.sample', { index: sampleId })}
          />
        )}
      </ChartScrollRegion>

      <p className="text-xs text-muted-foreground">
        {t('results.variableImportance.beeswarm.note')}
      </p>

      {onSampleSelect && (
        <div className="flex flex-wrap items-end gap-2 border-t pt-3">
          <div className="space-y-1">
            <Label htmlFor={inputId} className="text-xs text-muted-foreground">
              {t('results.variableImportance.beeswarm.toggleSample')}
            </Label>
            <Input
              id={inputId}
              type="number"
              min={0}
              max={Math.max(0, totalSamples - 1)}
              value={sampleInput}
              onChange={(event) => setSampleInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') toggleTyped();
              }}
              className="h-8 w-24 text-sm"
            />
          </div>
          <Button variant="outline" size="sm" className="h-8" onClick={toggleTyped}>
            {t('results.variableImportance.beeswarm.toggle')}
          </Button>
          <span className="text-xs text-muted-foreground min-w-0 flex-1" role="status">
            {selectedSamples.length > 0
              ? t('results.variableImportance.beeswarm.selectedList', { list: selectedSamples.join(', ') })
              : t('results.variableImportance.beeswarm.noneSelected')}
          </span>
          {selectedSamples.length > 0 && onClearSelection && (
            <Button variant="ghost" size="sm" className="h-8" onClick={onClearSelection}>
              <X className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
              {t('results.variableImportance.beeswarm.clearSelection')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
});
