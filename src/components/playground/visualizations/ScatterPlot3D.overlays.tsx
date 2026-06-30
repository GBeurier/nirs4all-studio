/**
 * Render-only DOM overlays for the ScatterPlot3D view (outside the WebGL canvas).
 *
 * Pure presentational components; all behavior is driven by props supplied by
 * the orchestrating ScatterPlot3D component.
 */

import { Download, RotateCcw, Box } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip as TooltipUI,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * Empty state shown when there is no data to render.
 */
export function ScatterPlot3DEmptyState() {
  return (
    <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
      <div className="text-center">
        <Box className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
        <p>No data for 3D view</p>
      </div>
    </div>
  );
}

interface ScatterPlot3DToolbarProps {
  onReset: () => void;
  onExport: () => void;
}

/**
 * Top-right control buttons: reset camera and export as PNG.
 */
export function ScatterPlot3DToolbar({ onReset, onExport }: ScatterPlot3DToolbarProps) {
  return (
    <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
      <TooltipProvider delayDuration={200}>
        <TooltipUI>
          <TooltipTrigger asChild>
            <Button
              variant="secondary"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={onReset}
            >
              <RotateCcw className="w-3 h-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="text-xs">Reset camera</p>
          </TooltipContent>
        </TooltipUI>

        <TooltipUI>
          <TooltipTrigger asChild>
            <Button
              variant="secondary"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={onExport}
            >
              <Download className="w-3 h-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="text-xs">Export as PNG</p>
          </TooltipContent>
        </TooltipUI>
      </TooltipProvider>
    </div>
  );
}

interface ScatterPlot3DInfoOverlaysProps {
  pointCount: number;
  selectedCount: number;
}

/**
 * Bottom overlays: interaction hints and sample/selection counts.
 */
export function ScatterPlot3DInfoOverlays({ pointCount, selectedCount }: ScatterPlot3DInfoOverlaysProps) {
  return (
    <>
      {/* Instructions overlay */}
      <div className="absolute bottom-2 left-2 z-10 text-[10px] text-muted-foreground bg-background/80 rounded px-2 py-1">
        Drag to rotate • Scroll to zoom • Right-drag to pan
      </div>

      {/* Sample count indicator */}
      <div className="absolute bottom-2 right-2 z-10 text-[10px] text-muted-foreground">
        {pointCount} points
        {selectedCount > 0 && (
          <span className="text-primary ml-1">• {selectedCount} sel</span>
        )}
      </div>
    </>
  );
}
