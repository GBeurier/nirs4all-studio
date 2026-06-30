import {
  SpectraWebGLAggregatedArea,
  SpectraWebGLGroupedAreas,
} from './SpectraWebGLAggregatedAreas';
import { SpectraWebGLAxes } from './SpectraWebGLAxes';
import { SpectraWebGLCamera } from './SpectraWebGLCamera';
import { SpectraWebGLInteractionController } from './SpectraWebGLInteractionController';
import { SpectraLines } from './SpectraWebGLLineLayers';
import { SpectraWebGLXZoomController } from './SpectraWebGLXZoomController';
import type { SpectraWebGLAreaStats } from './spectraWebGLAreaEntries';
import type { SpectraWebGLLineData } from './spectraWebGLLines';
import type { QualityConfig } from './spectraWebGLQuality';

export interface SpectraWebGLSceneProps {
  lines: SpectraWebGLLineData[];
  xRange: [number, number];
  yRange: [number, number];
  xViewRange: [number, number];
  onXViewRangeChange: (range: [number, number]) => void;
  qualityConfig: QualityConfig;
  showGrid: boolean;
  onHover: (index: number | null) => void;
  onClick: (index: number, event: MouseEvent) => void;
  hoveredIdx?: number | null;
  aggregatedStats?: SpectraWebGLAreaStats & {
    wavelengths: number[];
  };
  groupedStats?: {
    wavelengths: number[];
    groups: Map<string | number, SpectraWebGLAreaStats>;
    colors: string[];
  };
  unselectedOpacity?: number;
  selectedIndices?: Set<number>;
  pinnedIndices?: Set<number>;
  xLabel?: string;
}

export function SpectraWebGLScene({
  lines,
  xRange,
  yRange,
  xViewRange,
  onXViewRangeChange,
  qualityConfig,
  showGrid,
  onHover,
  onClick,
  hoveredIdx,
  aggregatedStats,
  groupedStats,
  unselectedOpacity,
  selectedIndices,
  pinnedIndices,
  xLabel,
}: SpectraWebGLSceneProps) {
  const isAggregateMode = Boolean(aggregatedStats || groupedStats);

  return (
    <>
      <SpectraWebGLCamera />
      <SpectraWebGLXZoomController xRange={xRange} onXViewRangeChange={onXViewRangeChange} />
      {!isAggregateMode && (
        <SpectraWebGLInteractionController lines={lines} onHover={onHover} onClick={onClick} />
      )}
      <SpectraWebGLAxes yRange={yRange} xViewRange={xViewRange} showGrid={showGrid} xLabel={xLabel} />

      {aggregatedStats && (
        <SpectraWebGLAggregatedArea
          wavelengths={aggregatedStats.wavelengths}
          min={aggregatedStats.min}
          max={aggregatedStats.max}
          median={aggregatedStats.median}
          mean={aggregatedStats.mean}
          std={aggregatedStats.std}
          quantileLower={aggregatedStats.quantileLower}
          quantileUpper={aggregatedStats.quantileUpper}
          xRange={xRange}
          yRange={yRange}
        />
      )}

      {groupedStats && (
        <SpectraWebGLGroupedAreas
          wavelengths={groupedStats.wavelengths}
          groupedStats={groupedStats.groups}
          xRange={xRange}
          yRange={yRange}
          colors={groupedStats.colors}
        />
      )}

      {!isAggregateMode && (
        <SpectraLines
          lines={lines}
          qualityConfig={qualityConfig}
          hoveredIdx={hoveredIdx}
          unselectedOpacity={unselectedOpacity}
          selectedIndices={selectedIndices}
          pinnedIndices={pinnedIndices}
        />
      )}
    </>
  );
}
