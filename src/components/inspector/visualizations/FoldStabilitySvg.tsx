import {
  buildFoldStabilityLinePath,
  scaleFoldStabilityX,
  scaleFoldStabilityY,
  type FoldStabilityLayout,
  type FoldStabilityLine,
} from '@/lib/inspector/foldStabilityData';
import { formatFoldStabilityFoldLabel } from '@/lib/inspector/foldStabilityPresentation';
import type { FoldStabilityHoveredLine } from './FoldStabilityTooltip';

interface FoldStabilitySvgProps {
  width: number;
  height: number;
  lines: FoldStabilityLine[];
  selectedChains: ReadonlySet<string>;
  hasSelection: boolean;
  effectiveHover: string | null;
  foldCount: number;
  yMin: number;
  layout: FoldStabilityLayout;
  yTicks: number[];
  xTicks: number[];
  bandPath: string | null;
  meanPath: string | null;
  onLineClick: (chainId: string) => void;
  onHoverLineChange: (line: FoldStabilityHoveredLine | null) => void;
  onContextHoverChange: (chainId: string | null) => void;
}

export function FoldStabilitySvg({
  width,
  height,
  lines,
  selectedChains,
  hasSelection,
  effectiveHover,
  foldCount,
  yMin,
  layout,
  yTicks,
  xTicks,
  bandPath,
  meanPath,
  onLineClick,
  onHoverLineChange,
  onContextHoverChange,
}: FoldStabilitySvgProps) {
  const { marginLeft, marginRight, marginTop, marginBottom, plotW } = layout;
  const scaleX = (foldIndex: number) => scaleFoldStabilityX(foldIndex, foldCount, layout);
  const scaleY = (value: number) => scaleFoldStabilityY(value, yMin, layout);

  return (
    <svg width={width} height={height} className="select-none">
      {yTicks.map((tick, i) => (
        <g key={i}>
          <line
            x1={marginLeft}
            x2={width - marginRight}
            y1={scaleY(tick)}
            y2={scaleY(tick)}
            stroke="#334155"
            strokeDasharray="3 3"
            opacity={0.4}
          />
          <text
            x={marginLeft - 6}
            y={scaleY(tick)}
            textAnchor="end"
            dominantBaseline="middle"
            className="fill-muted-foreground"
            fontSize={10}
          >
            {tick.toFixed(3)}
          </text>
        </g>
      ))}

      {xTicks.map((fi) => (
        <text
          key={fi}
          x={scaleX(fi)}
          y={height - marginBottom + 14}
          textAnchor="middle"
          className="fill-muted-foreground"
          fontSize={10}
        >
          {formatFoldStabilityFoldLabel(fi)}
        </text>
      ))}

      <text
        x={marginLeft + plotW / 2}
        y={height - 4}
        textAnchor="middle"
        className="fill-muted-foreground"
        fontSize={10}
      >
        Fold
      </text>

      {bandPath && (
        <path d={bandPath} fill="#94a3b8" fillOpacity={0.1} />
      )}
      {meanPath && (
        <path d={meanPath} fill="none" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.5} />
      )}

      {lines.map((line) => {
        if (line.points.length < 2) return null;

        const isChainSelected = hasSelection && selectedChains.has(line.chainId);
        const isChainHovered = effectiveHover === line.chainId;
        const dimmed = hasSelection && !isChainSelected;
        const pathD = buildFoldStabilityLinePath(line.points, { foldCount, yMin, layout });

        return (
          <g key={line.chainId}>
            <path
              d={pathD}
              fill="none"
              stroke="transparent"
              strokeWidth={12}
              cursor="pointer"
              onClick={() => onLineClick(line.chainId)}
              onMouseEnter={(e) => {
                onHoverLineChange({
                  chainId: line.chainId,
                  modelClass: line.modelClass,
                  mouseX: e.clientX,
                  mouseY: e.clientY,
                });
                onContextHoverChange(line.chainId);
              }}
              onMouseLeave={() => {
                onHoverLineChange(null);
                onContextHoverChange(null);
              }}
            />

            <path
              d={pathD}
              fill="none"
              stroke={line.color}
              strokeWidth={isChainHovered ? 2.5 : 1.5}
              opacity={dimmed ? 0.15 : isChainHovered ? 1 : 0.6}
              strokeLinejoin="round"
              pointerEvents="none"
            />

            {line.points.map((pt) => (
              <circle
                key={pt.foldIndex}
                cx={scaleX(pt.foldIndex)}
                cy={scaleY(pt.score)}
                r={isChainHovered ? 4 : 2.5}
                fill={line.color}
                fillOpacity={dimmed ? 0.15 : isChainHovered ? 1 : 0.6}
                pointerEvents="none"
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}
