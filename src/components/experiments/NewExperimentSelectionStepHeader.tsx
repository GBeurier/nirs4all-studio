import { Badge } from "@/components/ui/badge";
import { formatExperimentSelectionCount } from "@/lib/experimentSelectionPresentation";

export interface NewExperimentSelectionStepHeaderProps {
  selectedCount: number;
  title: string;
}

export function NewExperimentSelectionStepHeader({
  selectedCount,
  title,
}: NewExperimentSelectionStepHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <Badge variant="secondary">{formatExperimentSelectionCount(selectedCount)}</Badge>
    </div>
  );
}
