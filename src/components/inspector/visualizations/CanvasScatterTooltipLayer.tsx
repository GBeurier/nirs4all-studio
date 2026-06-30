import { getCanvasScatterTooltipStyle, type CanvasScatterPoint } from '@/lib/inspector/canvasScatterData';
import type { CanvasScatterTooltipPosition } from './useCanvasScatterInteraction';

interface CanvasScatterTooltipLayerProps {
  point: CanvasScatterPoint | null;
  position: CanvasScatterTooltipPosition | null;
  containerWidth: number;
  renderTooltip?: (point: CanvasScatterPoint) => React.ReactNode;
}

export function CanvasScatterTooltipLayer({
  point,
  position,
  containerWidth,
  renderTooltip,
}: CanvasScatterTooltipLayerProps) {
  if (!point || !position || !renderTooltip) {
    return null;
  }

  return (
    <div
      className="pointer-events-none absolute z-20"
      style={getCanvasScatterTooltipStyle({
        x: position.x,
        y: position.y,
        containerWidth,
      })}
    >
      {renderTooltip(point)}
    </div>
  );
}
