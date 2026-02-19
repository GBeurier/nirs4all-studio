import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Loader2 } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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
  binSize: number;
  binStride: number;
  binAggregation: BinAggregation;
  onBinSizeChange: (size: number) => void;
  onBinStrideChange: (stride: number) => void;
  onBinAggregationChange: (agg: BinAggregation) => void;
  onBinnedDataUpdate: (data: BinnedImportanceData) => void;
}

export function BinningControls({
  jobId,
  binSize,
  binStride,
  binAggregation,
  onBinSizeChange,
  onBinStrideChange,
  onBinAggregationChange,
  onBinnedDataUpdate,
}: BinningControlsProps) {
  const { t } = useTranslation();
  const [isRebinning, setIsRebinning] = useState(false);

  const handleRebin = useCallback(async () => {
    setIsRebinning(true);
    try {
      const result = await rebinShapResults(jobId, {
        bin_size: binSize,
        bin_stride: binStride,
        bin_aggregation: binAggregation,
      });
      onBinnedDataUpdate(result.binned_importance);
    } catch {
      // Rebin failed silently — the original data remains
    } finally {
      setIsRebinning(false);
    }
  }, [jobId, binSize, binStride, binAggregation, onBinnedDataUpdate]);

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
            if (!isNaN(val) && val >= 1) onBinSizeChange(val);
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
            if (!isNaN(val) && val >= 1) onBinStrideChange(val);
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
          onValueChange={(v) => onBinAggregationChange(v as BinAggregation)}
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

      <Button
        variant="outline"
        size="sm"
        className="h-8"
        onClick={handleRebin}
        disabled={isRebinning}
      >
        {isRebinning ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5 mr-1" />
        )}
        {t('shap.binning.rebin', 'Rebin')}
      </Button>
    </div>
  );
}
