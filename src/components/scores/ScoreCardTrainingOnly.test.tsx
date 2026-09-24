import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { datasetChainsToRows } from '@/lib/score-adapters';
import type { TopChainResult } from '@/types/enriched-runs';
import { ScoreCardTypeBadge } from './ScoreCardTypeBadge';
import { ScoreCardScoreDisplay } from './ScoreCardScoreDisplay';

describe('training-only result presentation', () => {
  it('renders a training label and the measured training RMSE without a CV/refit label', () => {
    const chain: TopChainResult = {
      chain_id: 'tabpfn-training', model_name: 'TabPFNRegressor', model_class: 'TabPFNRegressor',
      preprocessings: '', avg_train_score: 0.12, avg_val_score: null, avg_test_score: null,
      fold_count: 0, scores: { train: { rmse: 0.12 }, val: {}, test: {} },
      final_train_score: null, final_test_score: null, final_scores: {},
    };
    const [row] = datasetChainsToRows([chain], 'rmse', 'regression');
    const badge = renderToStaticMarkup(<ScoreCardTypeBadge row={row} />);
    expect(badge).toContain('Training only');
    expect(badge).not.toContain('Refit');
    expect(badge).not.toContain('CV');
    const scores = renderToStaticMarkup(<ScoreCardScoreDisplay row={row} selectedMetrics={['rmse']} />);
    expect(scores).toContain('0.12');
    expect(scores.toLowerCase()).toContain('train');
  });
});
