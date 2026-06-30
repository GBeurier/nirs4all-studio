import type { MouseEventHandler, Ref } from "react";
import { cn } from "@/lib/utils";

interface ScatterPureWebGL2DShellProps {
  canvasRef: Ref<HTMLCanvasElement>;
  className?: string;
  showAxes: boolean;
  xLabel?: string;
  yLabel?: string;
  isLoading?: boolean;
  onMouseMove: MouseEventHandler<HTMLCanvasElement>;
  onMouseLeave: MouseEventHandler<HTMLCanvasElement>;
  onClick: MouseEventHandler<HTMLCanvasElement>;
}

export function ScatterPureWebGL2DShell({
  canvasRef,
  className,
  showAxes,
  xLabel,
  yLabel,
  isLoading,
  onMouseMove,
  onMouseLeave,
  onClick,
}: ScatterPureWebGL2DShellProps) {
  return (
    <div className={cn("relative w-full h-full", className)}>
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ touchAction: "none" }}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onClick={onClick}
      />

      {showAxes && (
        <>
          {xLabel && (
            <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-xs text-muted-foreground">
              {xLabel}
            </div>
          )}
          {yLabel && (
            <div
              className={cn(
                "absolute left-1 top-1/2 -translate-y-1/2 -rotate-90 origin-center",
                "text-xs text-muted-foreground"
              )}
            >
              {yLabel}
            </div>
          )}
        </>
      )}

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50">
          <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      )}
    </div>
  );
}
