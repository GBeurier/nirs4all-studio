import type { ReactNode } from "react";

export interface NewExperimentSelectionResultsListProps {
  children: ReactNode;
  emptySearchMessage: string | null;
  itemCount: number;
}

export function NewExperimentSelectionResultsList({
  children,
  emptySearchMessage,
  itemCount,
}: NewExperimentSelectionResultsListProps) {
  return (
    <div className="max-h-80 space-y-2 overflow-y-auto">
      {children}
      {itemCount === 0 && emptySearchMessage && (
        <div className="py-4 text-center text-muted-foreground">
          {emptySearchMessage}
        </div>
      )}
    </div>
  );
}
