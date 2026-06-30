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
import {
  buildShapRebinRequest,
  getShapRebinErrorMessage,
  normalizeShapBinAggregation,
  parseShapBinSizeInput,
  parseShapBinStrideInput,
  SHAP_BIN_AGGREGATION_OPTIONS,
  SHAP_BIN_SIZE_LIMITS,
  SHAP_BIN_STRIDE_LIMITS,
} from '@/lib/shapBinningControlsData';
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
    normalizeShapBinAggregation(initialAggregation),
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
          const result = await rebinShapResults(jobId, buildShapRebinRequest(size, stride, agg));
          onBinnedDataUpdateRef.current(result.binned_importance);
        } catch (err) {
          const msg = getShapRebinErrorMessage(err);
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
            const val = parseShapBinSizeInput(e.target.value);
            if (val !== null) setBinSize(val);
          }}
          className="w-20 h-8 text-sm"
          min={SHAP_BIN_SIZE_LIMITS.min}
          max={SHAP_BIN_SIZE_LIMITS.max}
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
            const val = parseShapBinStrideInput(e.target.value);
            if (val !== null) setBinStride(val);
          }}
          className="w-20 h-8 text-sm"
          min={SHAP_BIN_STRIDE_LIMITS.min}
          max={SHAP_BIN_STRIDE_LIMITS.max}
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
            {SHAP_BIN_AGGREGATION_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
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
