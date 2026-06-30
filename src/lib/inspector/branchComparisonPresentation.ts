export const BRANCH_COMPARISON_EMPTY_MESSAGE = 'No branch comparison data available.';

export function getBranchComparisonEmptyMessage(): string {
  return BRANCH_COMPARISON_EMPTY_MESSAGE;
}

export function formatBranchComparisonLabel(label: string, maxLength = 16): string {
  return label.length > maxLength ? `${label.slice(0, maxLength - 2)}\u2026` : label;
}

export function formatBranchComparisonTick(value: number): string {
  return value.toFixed(3);
}

export function formatBranchComparisonScore(value: number): string {
  return value.toFixed(4);
}

export function formatBranchComparisonCountBadge(count: number): string {
  return `n=${count}`;
}

export function formatBranchComparisonChainCount(count: number): string {
  return `Chains: ${count}`;
}

export function formatBranchComparisonConfidenceInterval(lower: number, upper: number): string {
  return `CI: [${formatBranchComparisonScore(lower)}, ${formatBranchComparisonScore(upper)}]`;
}
