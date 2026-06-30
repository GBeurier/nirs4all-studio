import {
  formatBiasVariancePrecise,
  formatBiasVarianceSampleSummary,
  formatBiasVarianceShare,
} from '@/lib/inspector/biasVariancePresentation';
import type { BiasVarianceBarData } from '@/lib/inspector/biasVarianceData';

interface BiasVarianceTooltipPayloadEntry {
  payload: BiasVarianceBarData;
}

interface BiasVarianceTooltipProps {
  active?: boolean;
  payload?: BiasVarianceTooltipPayloadEntry[];
}

export function BiasVarianceTooltip({ active, payload }: BiasVarianceTooltipProps) {
  if (!active || !payload?.[0]) {
    return null;
  }

  const data = payload[0].payload;
  const total = Math.max(data.total_error, 1e-12);

  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      <div className="mb-1 font-medium">{data.group_label}</div>
      <div>Bias²: {formatBiasVariancePrecise(data.bias_squared)} ({formatBiasVarianceShare(data.bias_share)})</div>
      <div>Variance: {formatBiasVariancePrecise(data.variance)} ({formatBiasVarianceShare(data.variance_share)})</div>
      <div>Total error: {formatBiasVariancePrecise(total)}</div>
      <div className="mt-1 text-muted-foreground">
        {formatBiasVarianceSampleSummary({
          chainCount: data.n_chains,
          foldCount: data.n_folds,
          sampleCount: data.n_samples,
        })}
      </div>
    </div>
  );
}
