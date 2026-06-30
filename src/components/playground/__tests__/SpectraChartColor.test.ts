import { describe, expect, it } from 'vitest';

import {
  getSpectraLineBaseColor,
  applySpectraLineEmphasis,
  type SpectraLineBaseColor,
} from '@/lib/playground/spectraLineColor';
import { HIGHLIGHT_COLORS } from '@/lib/playground/colorConfig';

/**
 * VIZ-05 characterization tests.
 *
 * These pin the exact stroke a Recharts <Line> receives in the Canvas/SVG
 * fallback path. The legacy implementation computed everything in one
 * hover-dependent getColor(); the refactor splits it into a hover-stable base
 * (getSpectraLineBaseColor) plus a cheap per-line emphasis
 * (applySpectraLineEmphasis). `resolve()` re-composes them exactly as the
 * render path does, so these tests guarantee the visual semantics are
 * unchanged across every (state, mode) combination.
 */

const BASE = 'hsl(120, 70%, 50%)';

interface ResolveOpts {
  // base inputs
  isOutlier?: boolean;
  globalColorMode?: 'outlier' | 'target' | 'partition' | undefined;
  showOutlierOverlay?: boolean | undefined;
  baseColor?: string;
  isOriginal?: boolean;
  viewModeBoth?: boolean;
  // emphasis inputs
  isSelectedOnlyMode?: boolean;
  isHovered?: boolean;
  isSelected?: boolean;
  isPinned?: boolean;
  hasSelection?: boolean;
  selectionOverride?: boolean;
  highlightPinned?: boolean;
  selectionColor?: string | undefined;
  unselectedOpacity?: number;
}

/** Compose base + emphasis exactly as the render path does. */
function resolve(opts: ResolveOpts = {}): string {
  const base: SpectraLineBaseColor = getSpectraLineBaseColor({
    isOutlier: opts.isOutlier ?? false,
    globalColorMode: opts.globalColorMode,
    showOutlierOverlay: opts.showOutlierOverlay,
    baseColor: opts.baseColor ?? BASE,
    isOriginal: opts.isOriginal ?? false,
    viewModeBoth: opts.viewModeBoth ?? false,
  });
  return applySpectraLineEmphasis({
    base,
    isSelectedOnlyMode: opts.isSelectedOnlyMode ?? false,
    isHovered: opts.isHovered ?? false,
    isSelected: opts.isSelected ?? false,
    isPinned: opts.isPinned ?? false,
    hasSelection: opts.hasSelection ?? false,
    selectionOverride: opts.selectionOverride ?? false,
    highlightPinned: opts.highlightPinned ?? true,
    selectionColor: opts.selectionColor,
    unselectedOpacity: opts.unselectedOpacity ?? 0.3,
  });
}

describe('getSpectraLineBaseColor', () => {
  it('returns the raw base color in the default (non-outlier) case', () => {
    expect(getSpectraLineBaseColor({
      isOutlier: false, globalColorMode: 'target', showOutlierOverlay: true,
      baseColor: BASE, isOriginal: false, viewModeBoth: false,
    })).toEqual({ color: BASE, terminal: false, isOriginalBoth: false });
  });

  it('is terminal red for outliers in outlier color mode', () => {
    expect(getSpectraLineBaseColor({
      isOutlier: true, globalColorMode: 'outlier', showOutlierOverlay: true,
      baseColor: BASE, isOriginal: false, viewModeBoth: false,
    })).toEqual({ color: HIGHLIGHT_COLORS.outlier, terminal: true, isOriginalBoth: false });
  });

  it('is terminal unselected grey for non-outliers in outlier color mode', () => {
    expect(getSpectraLineBaseColor({
      isOutlier: false, globalColorMode: 'outlier', showOutlierOverlay: true,
      baseColor: BASE, isOriginal: false, viewModeBoth: false,
    })).toEqual({ color: HIGHLIGHT_COLORS.unselected, terminal: true, isOriginalBoth: false });
  });

  it('is terminal red as an overlay outside outlier mode (default overlay on)', () => {
    expect(getSpectraLineBaseColor({
      isOutlier: true, globalColorMode: 'target', showOutlierOverlay: undefined,
      baseColor: BASE, isOriginal: false, viewModeBoth: false,
    })).toEqual({ color: HIGHLIGHT_COLORS.outlier, terminal: true, isOriginalBoth: false });
  });

  it('does not overlay when showOutlierOverlay is explicitly false', () => {
    expect(getSpectraLineBaseColor({
      isOutlier: true, globalColorMode: 'target', showOutlierOverlay: false,
      baseColor: BASE, isOriginal: false, viewModeBoth: false,
    })).toEqual({ color: BASE, terminal: false, isOriginalBoth: false });
  });

  it('flags isOriginalBoth for an original line in both view mode', () => {
    expect(getSpectraLineBaseColor({
      isOutlier: false, globalColorMode: 'target', showOutlierOverlay: true,
      baseColor: BASE, isOriginal: true, viewModeBoth: true,
    })).toEqual({ color: BASE, terminal: false, isOriginalBoth: true });
  });
});

describe('applySpectraLineEmphasis priority (matches legacy getColor)', () => {
  it('hover wins over everything', () => {
    expect(resolve({ isHovered: true, isSelected: true, isPinned: true, hasSelection: true }))
      .toBe(HIGHLIGHT_COLORS.hovered);
  });

  it('selected with selectionOverride uses selectionColor when provided', () => {
    expect(resolve({ isSelected: true, hasSelection: true, selectionOverride: true, selectionColor: 'hsl(1,2%,3%)' }))
      .toBe('hsl(1,2%,3%)');
  });

  it('selected with selectionOverride and no selectionColor falls back to HIGHLIGHT_COLORS.selected', () => {
    expect(resolve({ isSelected: true, hasSelection: true, selectionOverride: true }))
      .toBe(HIGHLIGHT_COLORS.selected);
  });

  it('selected WITHOUT selectionOverride keeps the base color (no override)', () => {
    expect(resolve({ isSelected: true, hasSelection: true, selectionOverride: false }))
      .toBe(BASE);
  });

  it('pinned with highlightPinned uses the gold pinned color', () => {
    expect(resolve({ isPinned: true, highlightPinned: true }))
      .toBe(HIGHLIGHT_COLORS.pinned);
  });

  it('pinned without highlightPinned keeps the base color', () => {
    expect(resolve({ isPinned: true, highlightPinned: false }))
      .toBe(BASE);
  });

  it('dims non-selected non-pinned lines when a selection exists', () => {
    expect(resolve({ hasSelection: true, unselectedOpacity: 0.3 }))
      .toBe(`color-mix(in srgb, ${BASE} 30%, transparent)`);
  });

  it('rounds the dim opacity percentage', () => {
    expect(resolve({ hasSelection: true, unselectedOpacity: 0.256 }))
      .toBe(`color-mix(in srgb, ${BASE} 26%, transparent)`);
  });

  it('original-both lines get 50% transparency when not dimmed', () => {
    expect(resolve({ isOriginal: true, viewModeBoth: true }))
      .toBe(`color-mix(in srgb, ${BASE} 50%, transparent)`);
  });

  it('dimming takes priority over original-both transparency', () => {
    // Selection present + original-both: legacy returned the dim color, not 50%.
    expect(resolve({ isOriginal: true, viewModeBoth: true, hasSelection: true, unselectedOpacity: 0.3 }))
      .toBe(`color-mix(in srgb, ${BASE} 30%, transparent)`);
  });

  it('returns the plain base color with no state', () => {
    expect(resolve()).toBe(BASE);
  });
});

describe('applySpectraLineEmphasis selected_only mode (matches legacy)', () => {
  it('shows hover highlight in selected_only mode', () => {
    expect(resolve({ isSelectedOnlyMode: true, isHovered: true, isSelected: true }))
      .toBe(HIGHLIGHT_COLORS.hovered);
  });

  it('ignores selection/pin emphasis in selected_only mode (keeps base)', () => {
    expect(resolve({ isSelectedOnlyMode: true, isSelected: true, isPinned: true, hasSelection: true, selectionOverride: true }))
      .toBe(BASE);
  });

  it('never dims in selected_only mode', () => {
    expect(resolve({ isSelectedOnlyMode: true, hasSelection: true, unselectedOpacity: 0.3 }))
      .toBe(BASE);
  });
});

describe('applySpectraLineEmphasis terminal outlier bases', () => {
  it('outlier-mode terminal base is never dimmed', () => {
    expect(resolve({ isOutlier: true, globalColorMode: 'outlier', hasSelection: true }))
      .toBe(HIGHLIGHT_COLORS.outlier);
  });

  it('outlier overlay terminal base is never dimmed and ignores original-both transparency', () => {
    expect(resolve({ isOutlier: true, globalColorMode: 'target', isOriginal: true, viewModeBoth: true, hasSelection: true }))
      .toBe(HIGHLIGHT_COLORS.outlier);
  });

  it('hover still wins over a terminal outlier base', () => {
    expect(resolve({ isOutlier: true, globalColorMode: 'outlier', isHovered: true }))
      .toBe(HIGHLIGHT_COLORS.hovered);
  });
});
