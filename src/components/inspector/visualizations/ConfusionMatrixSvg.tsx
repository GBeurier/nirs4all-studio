import type { Dispatch, SetStateAction } from 'react';
import {
  buildConfusionMatrixCellView,
  formatConfusionMatrixLabel,
  type ConfusionMatrixLayout,
  type ConfusionMatrixSummary,
} from '@/lib/inspector/confusionMatrixData';
import type { ConfusionMatrixHoveredCell } from './ConfusionMatrixTooltip';

interface ConfusionMatrixSvgProps {
  labels: string[];
  layout: ConfusionMatrixLayout;
  summary: ConfusionMatrixSummary;
  hovered: ConfusionMatrixHoveredCell | null;
  setHovered: Dispatch<SetStateAction<ConfusionMatrixHoveredCell | null>>;
}

export function ConfusionMatrixSvg({
  labels,
  layout,
  summary,
  hovered,
  setHovered,
}: ConfusionMatrixSvgProps) {
  return (
    <svg width={layout.svgW} height={layout.svgH} className="select-none">
      <text
        x={layout.marginLeft + layout.plotW / 2}
        y={18}
        textAnchor="middle"
        className="fill-muted-foreground"
        fontSize={12}
        fontWeight={600}
      >
        Predicted
      </text>
      <text
        x={16}
        y={layout.marginTop + layout.plotH / 2}
        textAnchor="middle"
        className="fill-muted-foreground"
        fontSize={12}
        fontWeight={600}
        transform={`rotate(-90, 16, ${layout.marginTop + layout.plotH / 2})`}
      >
        Actual
      </text>

      <g transform={`translate(${layout.marginLeft}, ${layout.marginTop})`}>
        {labels.map((label, i) => (
          <g key={`col-${label}`}>
            <text
              x={i * layout.cellW + layout.cellW / 2}
              y={-18}
              textAnchor="middle"
              className="fill-foreground"
              fontSize={10}
              fontWeight={500}
            >
              {formatConfusionMatrixLabel(label, 14)}
            </text>
            <text
              x={i * layout.cellW + layout.cellW / 2}
              y={-6}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize={9}
            >
              {summary.colTotals.get(label) ?? 0}
            </text>
          </g>
        ))}

        {labels.map((label, i) => (
          <g key={`row-${label}`}>
            <text
              x={-10}
              y={i * layout.cellH + layout.cellH / 2 - 4}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-foreground"
              fontSize={10}
              fontWeight={500}
            >
              {formatConfusionMatrixLabel(label, 14)}
            </text>
            <text
              x={-10}
              y={i * layout.cellH + layout.cellH / 2 + 9}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted-foreground"
              fontSize={9}
            >
              {summary.rowTotals.get(label) ?? 0}
            </text>
          </g>
        ))}

        {labels.map((trueLabel, ri) =>
          labels.map((predLabel, ci) => {
            const cellView = buildConfusionMatrixCellView({
              trueLabel,
              predLabel,
              rowIndex: ri,
              colIndex: ci,
              summary,
              layout,
              hovered,
            });

            return (
              <g key={`${ri}-${ci}`}>
                <rect
                  x={cellView.x}
                  y={cellView.y}
                  width={cellView.width}
                  height={cellView.height}
                  fill={cellView.color}
                  opacity={cellView.opacity}
                  rx={4}
                  stroke={cellView.stroke}
                  strokeWidth={cellView.strokeWidth}
                  onMouseEnter={(e) => setHovered({
                    true_label: cellView.trueLabel,
                    pred_label: cellView.predLabel,
                    count: cellView.count,
                    normalized: cellView.normalized,
                    mouseX: e.clientX,
                    mouseY: e.clientY,
                  })}
                  onMouseLeave={() => setHovered(null)}
                />
                {cellView.showLabel && (
                  <text
                    x={cellView.labelX}
                    y={cellView.labelY}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={cellView.textColor}
                    fontSize={cellView.labelFontSize}
                    pointerEvents="none"
                    fontWeight={cellView.isDiagonal ? 600 : 500}
                  >
                    {cellView.label}
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
