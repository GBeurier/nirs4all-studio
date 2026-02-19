import { useState, useCallback, useEffect, useRef, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, AlertCircle } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { rebinShapResults } from '@/api/shap';
import type { BinAggregation, BinnedImportanceData } from '@/types/shap';

interface BinningControlsProps {
  jobId: string;
  initialBinSize: number;
  initialBinStride: number;
  initialAggregation: string;
  onBinnedDataUpdate: (data: BinnedImportanceData) => void;
}

export const BinningControls = memo(function BinningControls({
  jobId,
  initialBinSize,
  initialBinStride,
  initialAggregation,
  onBinnedDataUpdate,
}: BinningControlsProps) {
  const { t } = useTranslation();

  const [binSize, setBinSize] = useState(initialBinSize);
  const [binStride, setBinStride] = useState(initialBinStride);
  const [binAggregation, setBinAggregation] = useState<BinAggregation>(
    (initialAggregation as BinAggregation) || 'sum',
  );
  const [isRebinning, setIsRebinning] = useState(false);
  const [rebinError, setRebinError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const onBinnedDataUpdateRef = useRef(onBinnedDataUpdate);
  onBinnedDataUpdateRef.current = onBinnedDataUpdate;

  // Auto-rebin with debounce whenever any parameter changes
  const doRebin = useCallback(
    (size: number, stride: number, agg: BinAggregation) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        setIsRebinning(true);
        setRebinError(null);
        try {
          const result = await rebinShapResults(jobId, {
            bin_size: size,
            bin_stride: stride,
            bin_aggregation: agg,
          });
          onBinnedDataUpdateRef.current(result.binned_importance);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Rebin failed';
          setRebinError(msg);
          console.error('Rebin failed:', err);
        } finally {
          setIsRebinning(false);
        }
      }, 400);
    },
    [jobId],
  );

  // Track whether this is the first render (skip initial rebin)
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    doRebin(binSize, binStride, binAggregation);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [binSize, binStride, binAggregation, doRebin]);

  return (
    <div className="flex items-end gap-3 flex-wrap">
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">
          {t('shap.binning.size', 'Bin Size')}
        </Label>
        <Input
          type="number"
          value={binSize}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10);
            if (!isNaN(val) && val >= 1) setBinSize(val);
          }}
          className="w-20 h-8 text-sm"
          min={1}
          max={200}
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">
          {t('shap.binning.stride', 'Stride')}
        </Label>
        <Input
          type="number"
          value={binStride}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10);
            if (!isNaN(val) && val >= 1) setBinStride(val);
          }}
          className="w-20 h-8 text-sm"
          min={1}
          max={200}
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">
          {t('shap.binning.aggregation', 'Aggregation')}
        </Label>
        <Select
          value={binAggregation}
          onValueChange={(v) => setBinAggregation(v as BinAggregation)}
        >
          <SelectTrigger className="w-28 h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sum">Sum</SelectItem>
            <SelectItem value="sum_abs">Sum |SHAP|</SelectItem>
            <SelectItem value="mean">Mean</SelectItem>
            <SelectItem value="mean_abs">Mean |SHAP|</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isRebinning && (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mb-1" />
      )}
      {rebinError && (
        <span className="flex items-center gap-1 text-xs text-destructive mb-1" title={rebinError}>
          <AlertCircle className="h-3 w-3" />
          Error
        </span>
      )}
    </div>
  );
});
