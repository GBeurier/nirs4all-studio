import {
  buildCandlestickOutlierPoints,
  buildCandlestickTicks,
  getCandlestickCategoryGeometry,
  getCandlestickColor,
  getCandlestickSelectableChainIds,
  scaleCandlestickY,
  type CandlestickLayout,
} from '@/lib/inspector/candlestickData';
import {
  formatCandlestickLabel,
  formatCandlestickTick,
} from '@/lib/inspector/candlestickPresentation';
import type { CandlestickCategory } from '@/types/inspector';
import type { CandlestickHoveredBox } from './CandlestickTooltip';

interface CandlestickSvgProps {
  width: number;
  height: number;
  categories: CandlestickCategory[];
  yMin: number;
  layout: CandlestickLayout;
  hovered: CandlestickHoveredBox | null;
  onHoveredChange: (hovered: CandlestickHoveredBox | null) => void;
  onBoxClick: (chainIds: string[]) => void;
}

export function CandlestickSvg({
  width,
  height,
  categories,
  yMin,
  layout,
  hovered,
  onHoveredChange,
  onBoxClick,
}: CandlestickSvgProps) {
  const scaleY = (value: number) => scaleCandlestickY(value, yMin, layout);
  const ticks = buildCandlestickTicks(yMin, layout.yRange);

  return (
    <svg width={width} height={height} className="select-none">
      {ticks.map((tick, i) => (
        <g key={i}>
          <line
            x1={layout.marginLeft}
            x2={width - layout.marginRight}
            y1={scaleY(tick)}
            y2={scaleY(tick)}
            stroke="#334155"
            strokeDasharray="3 3"
            opacity={0.4}
          />
          <text
            x={layout.marginLeft - 6}
            y={scaleY(tick)}
            textAnchor="end"
            dominantBaseline="middle"
            className="fill-muted-foreground"
            fontSize={10}
          >
            {formatCandlestickTick(tick)}
          </text>
        </g>
      ))}

      {categories.map((category, categoryIndex) => {
        const color = getCandlestickColor(categoryIndex);
        const isHovered = hovered?.category.label === category.label;
        const geometry = getCandlestickCategoryGeometry({
          category,
          categoryIndex,
          yMin,
          layout,
          height,
        });
        const outlierPoints = buildCandlestickOutlierPoints({
          values: category.outlier_values,
          cx: geometry.cx,
          yMin,
          layout,
        });

        return (
          <g
            key={category.label}
            cursor="pointer"
            onClick={() => onBoxClick(getCandlestickSelectableChainIds(category))}
          >
            <line
              x1={geometry.cx}
              x2={geometry.cx}
              y1={geometry.yMin}
              y2={geometry.yMax}
              stroke={color}
              strokeWidth={1.5}
              opacity={0.6}
            />
            <line
              x1={geometry.capX1}
              x2={geometry.capX2}
              y1={geometry.yMin}
              y2={geometry.yMin}
              stroke={color}
              strokeWidth={1.5}
            />
            <line
              x1={geometry.capX1}
              x2={geometry.capX2}
              y1={geometry.yMax}
              y2={geometry.yMax}
              stroke={color}
              strokeWidth={1.5}
            />
            <rect
              x={geometry.boxX}
              y={geometry.boxY}
              width={layout.boxWidth}
              height={geometry.boxHeight}
              fill={color}
              fillOpacity={isHovered ? 0.5 : 0.3}
              stroke={color}
              strokeWidth={isHovered ? 2 : 1.5}
              rx={2}
              onMouseEnter={(e) => onHoveredChange({ category, mouseX: e.clientX, mouseY: e.clientY })}
              onMouseLeave={() => onHoveredChange(null)}
            />
            <line
              x1={geometry.medianX1}
              x2={geometry.medianX2}
              y1={geometry.yMedian}
              y2={geometry.yMedian}
              stroke={color}
              strokeWidth={2.5}
            />

            {outlierPoints.map((point, outlierIndex) => (
              <circle
                key={outlierIndex}
                cx={point.cx}
                cy={point.cy}
                r={3}
                fill={color}
                fillOpacity={0.6}
                stroke={color}
                strokeWidth={1}
              />
            ))}

            <text
              x={geometry.labelX}
              y={geometry.labelY}
              textAnchor="end"
              dominantBaseline="hanging"
              className="fill-muted-foreground"
              fontSize={10}
              transform={geometry.labelTransform}
            >
              {formatCandlestickLabel(category.label)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
