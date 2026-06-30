export const FOLD_STABILITY_EMPTY_MESSAGE = 'No fold stability data available. Select chains with multiple folds.';

export function getFoldStabilityEmptyMessage(): string {
  return FOLD_STABILITY_EMPTY_MESSAGE;
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
