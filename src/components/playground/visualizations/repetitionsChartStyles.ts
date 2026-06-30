import type { DiffQuantile } from '@/lib/playground/spectraConfig';

export const REPETITION_QUANTILE_COLORS: Record<DiffQuantile, string> = {
  50: 'hsl(var(--muted-foreground))',
  75: 'hsl(180, 60%, 50%)',
  90: 'hsl(45, 90%, 50%)',
  95: 'hsl(0, 70%, 55%)',
};
