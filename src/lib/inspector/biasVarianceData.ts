import type { BiasVarianceResponse } from '@/types/inspector';

export interface BiasVarianceBarData {
  group_label: string;
  bias_squared: number;
  variance: number;
  total_error: number;
  n_chains: number;
  n_folds: number;
  n_samples: number;
  chain_ids: string[];
  bias_share: number;
  variance_share: number;
}

export interface BiasVarianceTotals {
  totalBias: number;
  totalVariance: number;
  totalError: number;
}

export function buildBiasVarianceBars(
  data: BiasVarianceResponse | null | undefined,
): BiasVarianceBarData[] {
  return (data?.entries ?? []).map((entry) => {
    const bias = entry.bias_squared ?? 0;
    const variance = entry.variance ?? 0;
    const total = entry.total_error ?? bias + variance;
    return {
      group_label: entry.group_label,
      bias_squared: bias,
      variance,
      total_error: total,
      n_chains: entry.n_chains,
      n_folds: entry.n_folds,
      n_samples: entry.n_samples,
      chain_ids: entry.chain_ids ?? [],
      bias_share: total > 0 ? bias / total : 0,
      variance_share: total > 0 ? variance / total : 0,
    };
  });
}

export function sumBiasVarianceTotals(bars: readonly BiasVarianceBarData[]): BiasVarianceTotals {
  return {
    totalBias: bars.reduce((sum, bar) => sum + bar.bias_squared, 0),
    totalVariance: bars.reduce((sum, bar) => sum + bar.variance, 0),
    totalError: bars.reduce((sum, bar) => sum + bar.total_error, 0),
  };
}

export function getBiasVarianceSelectionMode(
  bar: Pick<BiasVarianceBarData, 'chain_ids'> | undefined,
  selectedChains: ReadonlySet<string>,
): 'add' | 'remove' | null {
  if (!bar || bar.chain_ids.length === 0) return null;
  return bar.chain_ids.every((chainId) => selectedChains.has(chainId)) ? 'remove' : 'add';
}
