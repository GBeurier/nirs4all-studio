import { describe, expect, it } from 'vitest';

import { computeSpectraWebGLCameraBounds } from '../spectraWebGLCameraBounds';

describe('computeSpectraWebGLCameraBounds', () => {
  it('uses the normalized chart bounds for wide containers', () => {
    expect(computeSpectraWebGLCameraBounds({ width: 1080, height: 720 })).toEqual({
      left: -0.06,
      right: 1.02,
      bottom: -0.12,
      top: 1.04,
    });
  });

  it('extends the vertical range symmetrically for tall containers', () => {
    const bounds = computeSpectraWebGLCameraBounds({ width: 720, height: 1440 });

    expect(bounds.left).toBe(-0.06);
    expect(bounds.right).toBe(1.02);
    expect(bounds.bottom).toBeCloseTo(-0.62);
    expect(bounds.top).toBeCloseTo(1.54);
  });

  it('supports custom chart margins', () => {
    expect(computeSpectraWebGLCameraBounds(
      { width: 800, height: 400 },
      { left: 0.1, right: 0.05, bottom: 0.2, top: 0.1 }
    )).toEqual({
      left: -0.1,
      right: 1.05,
      bottom: -0.2,
      top: 1.1,
    });
  });
});
