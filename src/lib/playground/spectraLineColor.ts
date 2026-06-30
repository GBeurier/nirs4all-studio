import {
  type GlobalColorConfig,
  HIGHLIGHT_COLORS,
} from '@/lib/playground/colorConfig';

/** Base stroke for a spectra line, independent of hover/selection state. */
export interface SpectraLineBaseColor {
  /** The resolved base stroke color (raw, before dimming / both-transparency). */
  color: string;
  /**
   * True when the color came from the outlier color-mode or outlier overlay,
   * which short-circuit before dimming / original-transparency in the legacy
   * getColor(). Emphasis must not apply dimming or both-mode transparency to a
   * terminal base.
   */
  terminal: boolean;
  /**
   * True when this is an original line in 'both' view mode. The legacy getColor
   * applied a 50% transparency as a fallback (only when dimming did not fire);
   * emphasis reproduces that, using the raw `color`.
   */
  isOriginalBoth: boolean;
}

/**
 * Resolve the hover/selection-independent base stroke for a line.
 * Mirrors the non-emphasis branches of the legacy getColor().
 */
export function getSpectraLineBaseColor(params: {
  isOutlier: boolean;
  globalColorMode: GlobalColorConfig['mode'] | undefined;
  showOutlierOverlay: boolean | undefined;
  baseColor: string;
  isOriginal: boolean;
  viewModeBoth: boolean;
}): SpectraLineBaseColor {
  const { isOutlier, globalColorMode, showOutlierOverlay, baseColor, isOriginal, viewModeBoth } = params;

  // Outlier color mode: red for outliers, grey for rest.
  if (globalColorMode === 'outlier') {
    return {
      color: isOutlier ? HIGHLIGHT_COLORS.outlier : HIGHLIGHT_COLORS.unselected,
      terminal: true,
      isOriginalBoth: false,
    };
  }

  // Outlier overlay in other color modes: show outliers as red.
  if (isOutlier && showOutlierOverlay !== false) {
    return { color: HIGHLIGHT_COLORS.outlier, terminal: true, isOriginalBoth: false };
  }

  return { color: baseColor, terminal: false, isOriginalBoth: isOriginal && viewModeBoth };
}

/**
 * Apply hover/selection emphasis on top of a base line color.
 * Mirrors the emphasis branches of the legacy getColor().
 */
export function applySpectraLineEmphasis(params: {
  base: SpectraLineBaseColor;
  isSelectedOnlyMode: boolean;
  isHovered: boolean;
  isSelected: boolean;
  isPinned: boolean;
  hasSelection: boolean;
  selectionOverride: boolean;
  highlightPinned: boolean;
  selectionColor: string | undefined;
  unselectedOpacity: number;
}): string {
  const {
    base, isSelectedOnlyMode, isHovered, isSelected, isPinned, hasSelection,
    selectionOverride, highlightPinned, selectionColor, unselectedOpacity,
  } = params;

  // Highlighted states take priority (except in selected_only mode).
  if (!isSelectedOnlyMode) {
    if (isHovered) return HIGHLIGHT_COLORS.hovered;
    if (isSelected && selectionOverride) return selectionColor ?? HIGHLIGHT_COLORS.selected;
    if (isPinned && highlightPinned) return HIGHLIGHT_COLORS.pinned;
  } else if (isHovered) {
    // In selected_only mode, only show hover highlight (not selection color).
    return HIGHLIGHT_COLORS.hovered;
  }

  // Terminal bases (outlier mode / overlay) skip dimming and both-transparency.
  if (base.terminal) return base.color;

  // Dim non-selected non-pinned lines when a selection exists.
  if (hasSelection && !isSelectedOnlyMode && !isSelected && !isPinned) {
    return `color-mix(in srgb, ${base.color} ${Math.round(unselectedOpacity * 100)}%, transparent)`;
  }

  // Original spectra are semi-transparent in 'both' mode when not dimmed.
  if (base.isOriginalBoth) {
    return `color-mix(in srgb, ${base.color} 50%, transparent)`;
  }

  return base.color;
}
