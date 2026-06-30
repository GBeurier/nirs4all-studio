import { useTranslation } from 'react-i18next';
import { Activity, Clock, Hash, Target } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { CardHeader, CardTitle } from '@/components/ui/card';
import { BinningControls } from './BinningControls';
import type {
  ShapInitialBinningParams,
  ShapResultsHeaderSummary,
} from '@/lib/shapResultsPanelData';
import type { BinnedImportanceData } from '@/types/shap';

interface ShapResultsHeaderProps {
  jobId: string;
  summary: ShapResultsHeaderSummary;
  initialBinParams: ShapInitialBinningParams;
  onBinnedDataChange: (data: BinnedImportanceData) => void;
}

export function ShapResultsHeader({
  jobId,
  summary,
  initialBinParams,
  onBinnedDataChange,
}: ShapResultsHeaderProps) {
  const { t } = useTranslation();

  return (
    <CardHeader className="pb-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          {t('shap.results.title', 'SHAP Analysis Results')}
        </CardTitle>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary" className="flex items-center gap-1">
            <Hash className="h-3 w-3" />
            {summary.sampleCount} {t('shap.results.samples', 'samples')}
          </Badge>
          <Badge variant="secondary" className="flex items-center gap-1">
            <Target className="h-3 w-3" />
            {summary.explainerType}
          </Badge>
          <Badge variant="outline" className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {summary.executionTimeLabel}
          </Badge>
        </div>
      </div>

      <div className="pt-2 border-t mt-2">
        <BinningControls
          jobId={jobId}
          initialBinSize={initialBinParams.binSize}
          initialBinStride={initialBinParams.binStride}
          initialAggregation={initialBinParams.aggregation}
          onBinnedDataUpdate={onBinnedDataChange}
        />
      </div>
    </CardHeader>
  );
}
