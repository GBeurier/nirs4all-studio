import type { ExperimentReviewGroupingRow } from "@/lib/experimentReviewPresentation";

import { NewExperimentReviewRuntimeGroupingRow } from "./NewExperimentReviewRuntimeGroupingRow";

export interface NewExperimentReviewRuntimeGroupingContentProps {
  groupingRows: readonly ExperimentReviewGroupingRow[];
  hasSplitters: boolean;
  noSplitterMessage: string;
}

export function NewExperimentReviewRuntimeGroupingContent({
  groupingRows,
  hasSplitters,
  noSplitterMessage,
}: NewExperimentReviewRuntimeGroupingContentProps) {
  if (!hasSplitters) {
    return <p className="text-sm text-muted-foreground">{noSplitterMessage}</p>;
  }

  return (
    <div className="space-y-2">
      {groupingRows.map((row) => (
        <NewExperimentReviewRuntimeGroupingRow key={row.id} row={row} />
      ))}
    </div>
  );
}
