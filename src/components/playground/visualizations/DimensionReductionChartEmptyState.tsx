import { Loader2, Orbit } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';

type DimensionReductionChartStateMethod = 'pca' | 'umap';

interface DimensionReductionChartEmptyStateProps {
  method: DimensionReductionChartStateMethod;
  error?: string;
  showComputeUMAP?: boolean;
  isUMAPLoading: boolean;
  onRequestUMAP?: () => void;
}

export function DimensionReductionChartEmptyState({
  method,
  error,
  showComputeUMAP = false,
  isUMAPLoading,
  onRequestUMAP,
}: DimensionReductionChartEmptyStateProps) {
  const { t } = useTranslation();

  return (
    <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
      <div className="text-center">
        <Orbit className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
        {error ? (
          <>
            <p>{t('playground.charts.dimReduction.empty.error', { method: method.toUpperCase() })}</p>
            <p className="text-xs mt-1">{error}</p>
          </>
        ) : (
          <>
            <p>{t('playground.charts.dimReduction.empty.needSamples', { method: method.toUpperCase() })}</p>
            {showComputeUMAP && onRequestUMAP && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={onRequestUMAP}
                disabled={isUMAPLoading}
              >
                {isUMAPLoading ? (
                  <>
                    <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                    {t('playground.charts.dimReduction.empty.computingUmap')}
                  </>
                ) : (
                  t('playground.charts.dimReduction.empty.computeUmap')
                )}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
