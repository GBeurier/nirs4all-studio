import { useMemo, useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { useInspectorSelection } from '@/context/useInspectorSelection';
import { buildBranchTopologyDiagramLayout } from '@/lib/inspector/branchTopologyData';
import { getBranchTopologyEmptyMessage } from '@/lib/inspector/branchTopologyPresentation';
import type { BranchTopologyResponse } from '@/types/inspector';
import { BranchTopologySvg } from './BranchTopologySvg';
import { BranchTopologyTooltip, type BranchTopologyHoveredNode } from './BranchTopologyTooltip';
import { useInspectorChartViewport } from './useInspectorChartViewport';

interface BranchTopologyDiagramProps {
  data: BranchTopologyResponse | null | undefined;
  isLoading: boolean;
}

export function BranchTopologyDiagram({ data, isLoading }: BranchTopologyDiagramProps) {
  const { select } = useInspectorSelection();
  const { viewportRef, dimensions } = useInspectorChartViewport();
  const [hovered, setHovered] = useState<BranchTopologyHoveredNode | null>(null);

  const layout = useMemo(() => {
    return buildBranchTopologyDiagramLayout({
      data,
      width: dimensions.width,
      height: dimensions.height,
    });
  }, [data, dimensions]);

  const handleNodeClick = useCallback((chainIds: string[]) => {
    if (chainIds.length) select(chainIds, 'toggle');
  }, [select]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        <span className="text-sm">Loading topology data...</span>
      </div>
    );
  }

  if (layout.allNodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {getBranchTopologyEmptyMessage()}
      </div>
    );
  }

  return (
    <div ref={viewportRef} className="relative h-full w-full overflow-auto">
      <BranchTopologySvg
        layout={layout}
        pipelineName={data?.pipeline_name}
        hovered={hovered}
        onHoveredChange={setHovered}
        onNodeClick={handleNodeClick}
      />

      <BranchTopologyTooltip hovered={hovered} />
    </div>
  );
}
