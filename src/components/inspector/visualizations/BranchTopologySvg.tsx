import {
  buildBranchTopologyEdgePath,
  getBranchTopologySelectableChainIds,
  type BranchTopologyDiagramLayout,
} from '@/lib/inspector/branchTopologyData';
import {
  buildBranchTopologyNodeView,
  formatBranchTopologyPipelineLabel,
} from '@/lib/inspector/branchTopologyPresentation';
import type { TopologyNode } from '@/types/inspector';
import type { BranchTopologyHoveredNode } from './BranchTopologyTooltip';

interface BranchTopologySvgProps {
  layout: BranchTopologyDiagramLayout;
  pipelineName?: string;
  hovered: BranchTopologyHoveredNode | null;
  onHoveredChange: (hovered: BranchTopologyHoveredNode | null) => void;
  onNodeClick: (chainIds: string[]) => void;
}

export function BranchTopologySvg({
  layout,
  pipelineName,
  hovered,
  onHoveredChange,
  onNodeClick,
}: BranchTopologySvgProps) {
  return (
    <svg width={layout.svgWidth} height={layout.svgHeight} className="select-none">
      {layout.edges.map((edge, i) => (
        <path
          key={i}
          d={buildBranchTopologyEdgePath(edge)}
          fill="none"
          stroke="#475569"
          strokeWidth={1.5}
          opacity={0.5}
        />
      ))}

      {layout.allNodes.map((layoutNode) => {
        const { node, x, y, width, height } = layoutNode;
        const view = buildBranchTopologyNodeView({
          layoutNode,
          hoveredNodeId: hovered?.node.id ?? null,
        });

        return (
          <g
            key={node.id}
            cursor={view.cursor}
            onClick={() => onNodeClick(getBranchTopologySelectableChainIds(node))}
            onMouseEnter={(e) => onHoveredChange({ node, mouseX: e.clientX, mouseY: e.clientY })}
            onMouseLeave={() => onHoveredChange(null)}
          >
            <rect
              x={x}
              y={y}
              width={width}
              height={height}
              rx={6}
              fill={view.color}
              fillOpacity={view.rectOpacity}
              stroke={view.color}
              strokeWidth={view.strokeWidth}
            />
            <text
              x={view.labelX}
              y={view.labelY}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-foreground"
              fontSize={10}
              fontWeight={500}
            >
              {view.label}
            </text>
            {view.hasScore && view.scoreLabel && (
              <text
                x={view.scoreX}
                y={view.scoreY}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={view.color}
                fontSize={9}
                fontWeight={600}
              >
                {view.scoreLabel}
              </text>
            )}
            <circle
              cx={view.indicatorCx}
              cy={view.indicatorCy}
              r={3}
              fill={view.color}
            />
          </g>
        );
      })}

      {pipelineName && (
        <text
          x={10}
          y={layout.svgHeight - 8}
          className="fill-muted-foreground"
          fontSize={9}
          opacity={0.6}
        >
          {formatBranchTopologyPipelineLabel(pipelineName)}
        </text>
      )}
    </svg>
  );
}
