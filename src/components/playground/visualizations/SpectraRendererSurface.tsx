import type { MouseEventHandler, RefObject, WheelEventHandler } from 'react';

import {
  SpectraContextMenu,
  type SpectraContextMenuProps,
} from './SpectraContextMenu';
import {
  SpectraRechartsPlot,
  type SpectraRechartsPlotProps,
} from './SpectraRechartsPlot';
import {
  SpectraWebGLBranch,
  type SpectraWebGLBranchProps,
} from './SpectraWebGLBranch';

type SpectraRendererContextMenuProps = Pick<
  SpectraContextMenuProps,
  | 'hoveredSample'
  | 'sampleIds'
  | 'yValues'
  | 'folds'
  | 'onExportSamples'
  | 'onSelectSimilar'
>;

export interface SpectraRendererSurfaceProps {
  chartAreaRef: RefObject<HTMLDivElement | null>;
  isWebGLMode: boolean;
  contextMenuProps: SpectraRendererContextMenuProps;
  onBackgroundClick: MouseEventHandler<HTMLDivElement>;
  onRechartsMouseUp: MouseEventHandler<HTMLDivElement>;
  onWheel: WheelEventHandler<HTMLDivElement>;
  onDoubleClick: MouseEventHandler<HTMLDivElement>;
  webglProps: SpectraWebGLBranchProps;
  rechartsProps: SpectraRechartsPlotProps;
}

export function SpectraRendererSurface({
  chartAreaRef,
  isWebGLMode,
  contextMenuProps,
  onBackgroundClick,
  onRechartsMouseUp,
  onWheel,
  onDoubleClick,
  webglProps,
  rechartsProps,
}: SpectraRendererSurfaceProps) {
  return (
    <SpectraContextMenu {...contextMenuProps}>
      <div
        ref={chartAreaRef}
        className="flex-1 min-h-0 relative"
        onClick={onBackgroundClick}
        onMouseUp={isWebGLMode ? undefined : onRechartsMouseUp}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
      >
        {isWebGLMode ? (
          <SpectraWebGLBranch {...webglProps} />
        ) : (
          <SpectraRechartsPlot {...rechartsProps} />
        )}
      </div>
    </SpectraContextMenu>
  );
}
