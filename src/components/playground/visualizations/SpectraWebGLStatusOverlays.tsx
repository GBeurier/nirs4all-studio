export interface SpectraWebGLStatusOverlaysProps {
  isLoading: boolean;
  showOriginalLegend: boolean;
  originalColor?: string;
  zoomLevel: number;
}

export function SpectraWebGLStatusOverlays({
  isLoading,
  showOriginalLegend,
  originalColor,
  zoomLevel,
}: SpectraWebGLStatusOverlaysProps) {
  return (
    <>
      {isLoading && (
        <div className="absolute inset-0 bg-background/50 flex items-center justify-center z-10">
          <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      )}

      {showOriginalLegend && (
        <div className="absolute top-2 left-2 text-[10px] text-muted-foreground bg-background/80 px-2 py-1 rounded flex items-center gap-2">
          <span className="flex items-center gap-1">
            <span className="w-4 h-0.5 bg-primary" />
            Processed
          </span>
          <span className="flex items-center gap-1">
            <span className="w-4 h-0.5 border-t border-dashed" style={{ borderColor: originalColor }} />
            Original
          </span>
        </div>
      )}

      <div className="absolute bottom-2 left-2 text-[10px] text-muted-foreground">
        Scroll to zoom X • Drag to pan • Double-click to reset
      </div>

      {zoomLevel > 1.05 && (
        <div className="absolute bottom-2 right-2 text-[10px] text-muted-foreground bg-background/80 px-2 py-0.5 rounded">
          {zoomLevel.toFixed(1)}× zoom
        </div>
      )}
    </>
  );
}
