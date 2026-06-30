import type { ExperimentReviewGroupingRow } from "@/lib/experimentReviewPresentation";

export interface NewExperimentReviewRuntimeGroupingRowProps {
  row: ExperimentReviewGroupingRow;
}

export function NewExperimentReviewRuntimeGroupingRow({
  row,
}: NewExperimentReviewRuntimeGroupingRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border/50 bg-background/70 px-3 py-2 text-sm">
      <span className="font-medium text-foreground">{row.datasetName}</span>
      <span className="text-muted-foreground">{row.summary}</span>
    </div>
  );
}
