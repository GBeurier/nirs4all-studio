import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ScoreCardTypeBadge } from './ScoreCardTypeBadge';
import type { ScoreCardRow } from '@/types/score-cards';

const row: ScoreCardRow = {
  id: 'chain', chainId: 'chain', modelName: 'Ridge', modelClass: 'Ridge',
  preprocessings: null, bestParams: null, cardType: 'refit', metric: 'rmse',
  testScores: {}, valScores: {}, trainScores: {}, primaryTestScore: 0.2,
  primaryValScore: null, primaryTrainScore: null, hasRefitArtifact: false,
};

describe('ScoreCardTypeBadge provenance', () => {
  it('exposes the CV substitution in visible text, without a tooltip or color dependency', () => {
    const html = renderToStaticMarkup(<ScoreCardTypeBadge row={{ ...row, syntheticRefit: true }} />);
    expect(html).toContain('>CV estimate — not a refit score</span>');
    expect(html).not.toContain('>Refit<');
  });

  it('does not infer synthetic measurements merely from missing artifacts', () => {
    const html = renderToStaticMarkup(<ScoreCardTypeBadge row={row} />);
    expect(html).toContain('>Refit<');
    expect(html).not.toContain('CV estimate');
  });
});
