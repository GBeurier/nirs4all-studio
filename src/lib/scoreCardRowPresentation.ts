import { foldLabelShort } from '@/lib/fold-utils';
import { canonicalMetricKey } from '@/lib/scores';
import { formatBestParams } from '@/lib/score-adapters';
import { cardTypeBorderClass } from '@/lib/scoreColumnData';
import type { ScoreCardRow, ScoreCardType } from '@/types/score-cards';

export interface ScoreCardRowTypeFlags {
  isRefit: boolean;
  isCrossval: boolean;
  isTrain: boolean;
}

export interface InlineScoreCardRowPresentation extends ScoreCardRowTypeFlags {
  borderClass: string;
  shellClass: string;
  detailClass: string;
  paramLabel: string | null;
}

export interface TableScoreCardRowPresentation extends ScoreCardRowTypeFlags {
  metric: string;
  foldDisplay: string | number;
  tableMetricKeys: string[];
}

export function getScoreCardRowTypeFlags(cardType: ScoreCardType): ScoreCardRowTypeFlags {
  return {
    isRefit: cardType === 'refit',
    isCrossval: cardType === 'crossval',
    isTrain: cardType === 'train',
  };
}

export function getScoreCardRowShellClass(cardType: ScoreCardType): string {
  switch (cardType) {
    case 'refit':
      return 'lg:grid lg:grid-cols-[25.5rem_minmax(0,1fr)_auto] lg:items-center lg:gap-2';
    case 'crossval':
      return 'lg:grid lg:grid-cols-[26rem_minmax(0,1fr)_auto] lg:items-center lg:gap-2';
    case 'train':
      return 'lg:grid lg:grid-cols-[23rem_minmax(0,1fr)_auto] lg:items-center lg:gap-2';
  }
}

export function getScoreCardRowDetailClass(cardType: ScoreCardType): string {
  switch (cardType) {
    case 'refit':
      return 'lg:grid lg:grid-cols-[14rem_10.5rem] lg:items-center lg:gap-2';
    case 'crossval':
      return 'lg:grid lg:grid-cols-[14rem_11rem] lg:items-center lg:gap-2';
    case 'train':
      return 'lg:grid lg:grid-cols-[12rem_10rem] lg:items-center lg:gap-2';
  }
}

export function buildInlineScoreCardRowPresentation(row: ScoreCardRow): InlineScoreCardRowPresentation {
  return {
    ...getScoreCardRowTypeFlags(row.cardType),
    borderClass: cardTypeBorderClass(row.cardType),
    shellClass: getScoreCardRowShellClass(row.cardType),
    detailClass: getScoreCardRowDetailClass(row.cardType),
    paramLabel: row.bestParams ? formatBestParams(row.bestParams) : null,
  };
}

export function buildTableScoreCardRowPresentation(
  row: ScoreCardRow,
  selectedMetrics: string[],
  maxTableMetrics?: number,
): TableScoreCardRowPresentation {
  return {
    ...getScoreCardRowTypeFlags(row.cardType),
    metric: canonicalMetricKey(row.metric || 'rmse') || 'rmse',
    foldDisplay: row.foldId ? foldLabelShort(row.foldId) : (row.foldCount ?? '—'),
    tableMetricKeys: maxTableMetrics == null ? selectedMetrics : selectedMetrics.slice(0, maxTableMetrics),
  };
}
