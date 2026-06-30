interface ConfusionMatrixHeaderProps {
  segments: string[];
}

export function ConfusionMatrixHeader({ segments }: ConfusionMatrixHeaderProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Classification confusion matrix</span>
      {segments.map((segment, index) => (
        <span key={`${index}-${segment}`} className="contents">
          {index > 0 && <span>•</span>}
          <span>{segment}</span>
        </span>
      ))}
    </div>
  );
}
