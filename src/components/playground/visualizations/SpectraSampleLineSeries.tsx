import { Fragment } from 'react';
import { Line } from 'recharts';

import { ANIMATION_CONFIG, CHART_THEME } from './chartConfig';
import {
  applySpectraLineEmphasis,
  type SpectraLineBaseColor,
} from '@/lib/playground/spectraLineColor';

export interface SpectraLineColorSettings {
  selectionOverride: boolean;
  highlightPinned: boolean;
  selectionColor: string | undefined;
  unselectedOpacity: number;
}

export interface SpectraSampleLineSeriesProps {
  displayIndices: number[];
  showOriginal: boolean;
  showProcessed: boolean;
  showDifference: boolean;
  viewModeBoth: boolean;
  selectedSamples: ReadonlySet<number>;
  pinnedSamples: ReadonlySet<number>;
  hoveredSample: number | null;
  hasSelection: boolean;
  isSelectedOnlyMode: boolean;
  colorConfig: SpectraLineColorSettings;
  getBaseLineColor: (sampleIndex: number, isOriginal: boolean) => SpectraLineBaseColor;
  referenceLineCount?: number;
}

export function SpectraSampleLineSeries({
  displayIndices,
  showOriginal,
  showProcessed,
  showDifference,
  viewModeBoth,
  selectedSamples,
  pinnedSamples,
  hoveredSample,
  hasSelection,
  isSelectedOnlyMode,
  colorConfig,
  getBaseLineColor,
  referenceLineCount = 0,
}: SpectraSampleLineSeriesProps) {
  const renderSampleLine = (sampleIndex: number, displayIndex: number, isOriginal: boolean) => {
    const isSelected = selectedSamples.has(sampleIndex);
    const isHovered = hoveredSample === sampleIndex;
    const isPinned = pinnedSamples.has(sampleIndex);
    const highlighted = isSelected || isHovered || isPinned;
    const stroke = applySpectraLineEmphasis({
      base: getBaseLineColor(sampleIndex, isOriginal),
      isSelectedOnlyMode,
      isHovered,
      isSelected,
      isPinned,
      hasSelection,
      selectionOverride: colorConfig.selectionOverride,
      highlightPinned: colorConfig.highlightPinned,
      selectionColor: colorConfig.selectionColor,
      unselectedOpacity: colorConfig.unselectedOpacity,
    });

    return (
      <Line
        key={`${isOriginal ? 'orig' : 'proc'}-${displayIndex}`}
        type="monotone"
        dataKey={`${isOriginal ? 'o' : 'p'}${displayIndex}`}
        stroke={stroke}
        strokeWidth={highlighted ? CHART_THEME.selectedLineStrokeWidth : CHART_THEME.lineStrokeWidth}
        strokeDasharray={isOriginal && viewModeBoth ? '4 2' : undefined}
        dot={false}
        activeDot={false}
        {...ANIMATION_CONFIG}
      />
    );
  };

  return (
    <Fragment>
      {showOriginal && displayIndices.map((sampleIndex, displayIndex) => (
        renderSampleLine(sampleIndex, displayIndex, true)
      ))}

      {(showProcessed || showDifference) && displayIndices.map((sampleIndex, displayIndex) => (
        renderSampleLine(sampleIndex, displayIndex, false)
      ))}

      {Array.from({ length: referenceLineCount }, (_, referenceIndex) => (
        <Line
          key={`ref-${referenceIndex}`}
          type="monotone"
          dataKey={`r${referenceIndex}`}
          stroke={CHART_THEME.referenceLineColor}
          strokeWidth={CHART_THEME.lineStrokeWidth}
          strokeDasharray={CHART_THEME.referenceDashArray}
          strokeOpacity={CHART_THEME.referenceLineOpacity}
          dot={false}
          activeDot={false}
          {...ANIMATION_CONFIG}
        />
      ))}
    </Fragment>
  );
}
