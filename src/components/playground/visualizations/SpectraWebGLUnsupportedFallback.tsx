export function SpectraWebGLUnsupportedFallback() {
  return (
    <div className="flex items-center justify-center h-full text-center p-4">
      <div>
        <div className="text-muted-foreground mb-2">WebGL is not supported on this device</div>
        <div className="text-xs text-muted-foreground">Please use Canvas rendering mode or try a different browser</div>
      </div>
    </div>
  );
}
