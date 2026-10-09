import {
  type GlobalColorConfig,
  getCategoricalColor,
  getContinuousColor,
} from '@/lib/playground/colorConfig';
import { useTranslation } from 'react-i18next';

export interface FoldDistributionLegendPartition {
  partitionType: 'train' | 'val' | 'test';
  foldIndex: number | null;
}

export interface FoldDistributionFooterProps<TPartition extends FoldDistributionLegendPartition> {
  compact: boolean;
  showLegend: boolean;
  showYLegend: boolean;
  effectiveColorMode: GlobalColorConfig['mode'];
  partitionBars: TPartition[];
  partitionSegmentKeys: string[];
  trainColor: string;
  valColor: string;
  heldOutTestColor: string;
  selectedFold: number | null;
  selectedCount: number;
  isClassificationMode: boolean;
  classLabels: string[];
  hasYValues: boolean;
  categoricalPalette?: GlobalColorConfig['categoricalPalette'];
  continuousPalette?: GlobalColorConfig['continuousPalette'];
  getPartitionSegmentColor: (segmentKey: string, entry: TPartition) => string;
  getSegmentLabel: (segmentKey: string) => string;
}

export function FoldDistributionFooter<TPartition extends FoldDistributionLegendPartition>({
  compact,
  showLegend,
  showYLegend,
  effectiveColorMode,
  partitionBars,
  partitionSegmentKeys,
  trainColor,
  valColor,
  heldOutTestColor,
  selectedFold,
  selectedCount,
  isClassificationMode,
  classLabels,
  hasYValues,
  categoricalPalette = 'default',
  continuousPalette = 'blue_red',
  getPartitionSegmentColor,
  getSegmentLabel,
}: FoldDistributionFooterProps<TPartition>) {
  const { t } = useTranslation();

  if (compact) {
    return null;
  }

  const hasPartitionBars = partitionBars.length > 0;
  const hasValidationPartition = partitionBars.some(partition => partition.partitionType === 'val');
  const hasTestPartition = partitionBars.some(partition => partition.partitionType === 'test');
  const foldIndices = Array.from(new Set(partitionBars.map(partition => partition.foldIndex)))
    .filter((foldIndex): foldIndex is number => foldIndex !== null);

  return (
    <>
      <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {showLegend && effectiveColorMode === 'partition' && hasPartitionBars && (
            <>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: trainColor }} />
                {t('playground.charts.fold.footer.train')}
              </span>
              {hasValidationPartition && (
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: valColor }} />
                  {t('playground.charts.fold.footer.val')}
                </span>
              )}
              {hasTestPartition && (
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: heldOutTestColor }} />
                  {t('playground.charts.fold.footer.test')}
                </span>
              )}
            </>
          )}

          {showLegend && effectiveColorMode === 'fold' && hasPartitionBars && (
            <>
              {foldIndices.map((foldIndex) => (
                <span key={`fold-${foldIndex}`} className="flex items-center gap-1">
                  <span
                    className="w-2 h-2 rounded-sm"
                    style={{ backgroundColor: getCategoricalColor(foldIndex, categoricalPalette) }}
                  />
                  {t('playground.charts.fold.footer.foldN', { n: foldIndex + 1 })}
                </span>
              ))}
              {hasTestPartition && (
                <span className="flex items-center gap-1">
                  <span
                    className="w-2 h-2 rounded-sm"
                    style={{ backgroundColor: heldOutTestColor }}
                  />
                  {t('playground.charts.fold.footer.test')}
                </span>
              )}
            </>
          )}

          {showLegend && effectiveColorMode !== 'partition' && effectiveColorMode !== 'fold' && hasPartitionBars && (
            partitionSegmentKeys.map((segmentKey) => (
              <span key={segmentKey} className="flex items-center gap-1">
                <span
                  className="w-2 h-2 rounded-sm"
                  style={{ backgroundColor: getPartitionSegmentColor(segmentKey, partitionBars[0]) }}
                />
                {getSegmentLabel(segmentKey)}
              </span>
            ))
          )}
        </div>

        {selectedFold !== null && (
          <span>
            {t('playground.charts.fold.footer.foldSelected', { n: selectedFold + 1 })}
          </span>
        )}

        {selectedCount > 0 && (
          <span className="text-primary font-medium">
            {t('playground.charts.fold.footer.selected', { count: selectedCount })}
          </span>
        )}
      </div>

      {showYLegend && effectiveColorMode === 'target' && hasYValues && (
        isClassificationMode ? (
          <div className="flex flex-wrap items-center gap-2 mt-1 text-[10px]">
            <span className="text-muted-foreground">{t('playground.charts.fold.footer.classLabel')}</span>
            {classLabels.map((label, index) => (
              <div key={label} className="flex items-center gap-0.5">
                <span
                  className="w-3 h-2 rounded-sm"
                  style={{ backgroundColor: getCategoricalColor(index, categoricalPalette) }}
                />
                <span className="truncate max-w-[50px]">{label}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 mt-1 text-[10px]">
            <span className="text-muted-foreground">{t('playground.charts.fold.footer.yValue')}</span>
            <div className="flex items-center gap-0.5">
              <span className="w-3 h-2 rounded-sm" style={{ backgroundColor: getContinuousColor(0, continuousPalette) }} />
              <span>{t('playground.charts.fold.footer.low')}</span>
            </div>
            <div className="w-12 h-2 rounded-sm bg-gradient-to-r from-blue-500 via-cyan-500 to-red-500" />
            <div className="flex items-center gap-0.5">
              <span className="w-3 h-2 rounded-sm" style={{ backgroundColor: getContinuousColor(1, continuousPalette) }} />
              <span>{t('playground.charts.fold.footer.high')}</span>
            </div>
          </div>
        )
      )}
    </>
  );
}
