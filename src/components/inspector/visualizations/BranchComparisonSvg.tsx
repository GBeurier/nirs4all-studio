import {
  buildBranchComparisonTicks,
  getBranchComparisonColor,
  getBranchComparisonGeometry,
  getBranchComparisonSelectableChainIds,
  scaleBranchComparisonX,
  type BranchComparisonLayout,
} from '@/lib/inspector/branchComparisonData';
import {
  formatBranchComparisonCountBadge,
  formatBranchComparisonLabel,
  formatBranchComparisonTick,
} from '@/lib/inspector/branchComparisonPresentation';
import type { BranchComparisonEntry } from '@/types/inspector';
import type { BranchComparisonHoveredBar } from './BranchComparisonTooltip';

interface BranchComparisonSvgProps {
  width: number;
  height: number;
  branches: BranchComparisonEntry[];
  scoreColumn?: string;
  xMin: number;
  layout: BranchComparisonLayout;
  hovered: BranchComparisonHoveredBar | null;
  onHoveredChange: (hovered: BranchComparisonHoveredBar | null) => void;
  onBarClick: (chainIds: string[]) => void;
}

export function BranchComparisonSvg({
  width,
  height,
  branches,
  scoreColumn,
  xMin,
  layout,
  hovered,
  onHoveredChange,
  onBarClick,
}: BranchComparisonSvgProps) {
  const scaleX = (value: number) => scaleBranchComparisonX(value, xMin, layout);
  const ticks = buildBranchComparisonTicks(xMin, layout.xRange);

  return (
    <svg width={width} height={height} className="select-none">
      {ticks.map((tick, i) => (
        <g key={i}>
          <line
            x1={scaleX(tick)}
            x2={scaleX(tick)}
            y1={layout.marginTop}
            y2={height - layout.marginBottom}
            stroke="#334155"
            strokeDasharray="3 3"
            opacity={0.4}
          />
          <text
            x={scaleX(tick)}
            y={height - layout.marginBottom + 14}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize={10}
          >
            {formatBranchComparisonTick(tick)}
          </text>
        </g>
      ))}

      {scoreColumn && (
        <text
          x={layout.marginLeft + layout.plotW / 2}
          y={height - 4}
          textAnchor="middle"
          className="fill-muted-foreground"
          fontSize={10}
        >
          {scoreColumn}
        </text>
      )}

      {branches.map((branch, branchIndex) => {
        const color = getBranchComparisonColor(branchIndex);
        const isHovered = hovered?.branch.branch_path === branch.branch_path;
        const geometry = getBranchComparisonGeometry({
          branch,
          branchIndex,
          xMin,
          layout,
        });

        return (
          <g
            key={branch.branch_path}
            cursor="pointer"
            onClick={() => onBarClick(getBranchComparisonSelectableChainIds(branch))}
          >
            <line
              x1={geometry.xCiLower}
              x2={geometry.xCiUpper}
              y1={geometry.cy}
              y2={geometry.cy}
              stroke={color}
              strokeWidth={1.5}
              opacity={0.6}
            />
            <line
              x1={geometry.xCiLower}
              x2={geometry.xCiLower}
              y1={geometry.cy - layout.barHeight * 0.3}
              y2={geometry.cy + layout.barHeight * 0.3}
              stroke={color}
              strokeWidth={1.5}
            />
            <line
              x1={geometry.xCiUpper}
              x2={geometry.xCiUpper}
              y1={geometry.cy - layout.barHeight * 0.3}
              y2={geometry.cy + layout.barHeight * 0.3}
              stroke={color}
              strokeWidth={1.5}
            />
            <rect
              x={geometry.barLeft}
              y={geometry.barY}
              width={geometry.barWidth}
              height={layout.barHeight}
              fill={color}
              fillOpacity={isHovered ? 0.6 : 0.4}
              stroke={color}
              strokeWidth={isHovered ? 2 : 1}
              rx={2}
              onMouseEnter={(e) => onHoveredChange({ branch, mouseX: e.clientX, mouseY: e.clientY })}
              onMouseLeave={() => onHoveredChange(null)}
            />
            <circle
              cx={geometry.xMean}
              cy={geometry.cy}
              r={3.5}
              fill={color}
              stroke="white"
              strokeWidth={1}
            />
            <text
              x={layout.marginLeft - 6}
              y={geometry.cy}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted-foreground"
              fontSize={10}
            >
              {formatBranchComparisonLabel(branch.label)}
            </text>
            <text
              x={geometry.countX}
              y={geometry.cy}
              dominantBaseline="middle"
              className="fill-muted-foreground"
              fontSize={9}
              opacity={0.7}
            >
              {formatBranchComparisonCountBadge(branch.count)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
