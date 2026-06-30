export interface NewExperimentSelectionDetailChipsProps {
  labels: readonly string[];
}

export function NewExperimentSelectionDetailChips({
  labels,
}: NewExperimentSelectionDetailChipsProps) {
  if (labels.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
      {labels.map((label) => (
        <span key={label}>{label}</span>
      ))}
    </div>
  );
}
