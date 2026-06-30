import {
  buildPerformanceHeatmapCellStyle,
  buildPerformanceHeatmapHoverPayload,
  getPerformanceHeatmapCellGeometry,
  getPerformanceHeatmapCellKey,
  getPerformanceHeatmapSelectableChainIds,
  type PerformanceHeatmapLayout,
} from '@/lib/inspector/performanceHeatmapData';
import {
  formatPerformanceHeatmapCellValue,
  formatPerformanceHeatmapLabel,
  getPerformanceHeatmapValueFontSize,
  shouldShowPerformanceHeatmapValue,
} from '@/lib/inspector/performanceHeatmapPresentation';
import type { ContinuousPalette } from '@/lib/playground/colorConfig';
import type { HeatmapCell } from '@/types/inspector';
import type { PerformanceHeatmapHoveredCell } from './PerformanceHeatmapTooltip';

interface PerformanceHeatmapSvgProps {
  xLabels: string[];
  yLabels: string[];
  cellMap: ReadonlyMap<string, HeatmapCell>;
  layout: PerformanceHeatmapLayout;
  minValue: number | null;
  maxValue: number | null;
  palette: ContinuousPalette;
  hovered: PerformanceHeatmapHoveredCell | null;
  onHoveredChange: (hovered: PerformanceHeatmapHoveredCell | null) => void;
  onCellClick: (chainIds: string[]) => void;
}

export function PerformanceHeatmapSvg({
  xLabels,
  yLabels,
  cellMap,
  layout,
  minValue,
  maxValue,
  palette,
  hovered,
  onHoveredChange,
  onCellClick,
}: PerformanceHeatmapSvgProps) {
  return (
    <svg width={layout.svgW} height={layout.svgH} className="select-none">
      <g transform={`translate(${layout.labelMarginLeft}, ${layout.headerHeight})`}>
        {yLabels.map((yLabel, yIndex) => (
          <text
            key={`y-${yIndex}`}
            x={-4}
            y={yIndex * layout.cellH + layout.cellH / 2}
            textAnchor="end"
            dominantBaseline="middle"
            className="fill-muted-foreground"
            fontSize={10}
          >
            {formatPerformanceHeatmapLabel(yLabel)}
          </text>
        ))}

        {xLabels.map((xLabel, xIndex) => {
          const x = xIndex * layout.cellW + layout.cellW / 2;
          const y = layout.gridH + 12;

          return (
            <text
              key={`x-${xIndex}`}
              x={x}
              y={y}
              textAnchor="end"
              dominantBaseline="hanging"
              className="fill-muted-foreground"
              fontSize={10}
              transform={`rotate(-45, ${x}, ${y})`}
            >
              {formatPerformanceHeatmapLabel(xLabel)}
            </text>
          );
        })}

        {xLabels.map((xLabel, xIndex) =>
          yLabels.map((yLabel, yIndex) => {
            const cell = cellMap.get(getPerformanceHeatmapCellKey(xLabel, yLabel));
            const value = cell?.value ?? null;
            const isHovered = hovered?.x_label === xLabel && hovered?.y_label === yLabel;
            const geometry = getPerformanceHeatmapCellGeometry(xIndex, yIndex, layout);
            const style = buildPerformanceHeatmapCellStyle({
              value,
              minValue,
              maxValue,
              palette,
              isHovered,
            });

            return (
              <g key={`${xIndex}-${yIndex}`}>
                <rect
                  x={geometry.x}
                  y={geometry.y}
                  width={geometry.width}
                  height={geometry.height}
                  fill={style.fill}
                  opacity={style.opacity}
                  rx={2}
                  cursor="pointer"
                  stroke={style.stroke}
                  strokeWidth={style.strokeWidth}
                  onClick={() => onCellClick(getPerformanceHeatmapSelectableChainIds(cell))}
                  onMouseEnter={(event) => onHoveredChange({
                    ...buildPerformanceHeatmapHoverPayload({ xLabel, yLabel, cell }),
                    mouseX: event.clientX,
                    mouseY: event.clientY,
                  })}
                  onMouseLeave={() => onHoveredChange(null)}
                />
                {value !== null && shouldShowPerformanceHeatmapValue(value, layout) && (
                  <text
                    x={geometry.centerX}
                    y={geometry.centerY}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#fff"
                    fontSize={getPerformanceHeatmapValueFontSize(layout)}
                    pointerEvents="none"
                    fontWeight={500}
                  >
                    {formatPerformanceHeatmapCellValue(value)}
                  </text>
                )}
              </g>
            );
          }),
        )}
      </g>
    </svg>
  );
}
