import type { TFunction } from 'i18next';

export function getFoldStabilityEmptyMessage(t: TFunction): string {
  return t('inspector.charts.empty.foldStability');
}

export function formatFoldStabilityChainPreview(chainId: string, maxLength = 12): string {
  return chainId.length > maxLength ? `${chainId.slice(0, maxLength)}…` : chainId;
}

export function formatFoldStabilityScore(score: number): string {
  return score.toFixed(4);
}

export function formatFoldStabilityFoldLabel(foldIndex: number): string {
  return `F${foldIndex + 1}`;
}
