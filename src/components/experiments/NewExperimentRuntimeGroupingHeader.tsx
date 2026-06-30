import { Badge } from "@/components/ui/badge";
import {
  formatRuntimeGroupingSelectedDatasetCount,
  runtimeGroupingPresentationCopy,
} from "@/lib/runtimeGroupingPresentation";

export interface NewExperimentRuntimeGroupingHeaderProps {
  selectedDatasetCount: number;
}

export function NewExperimentRuntimeGroupingHeader({
  selectedDatasetCount,
}: NewExperimentRuntimeGroupingHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-lg font-semibold text-foreground">
        {runtimeGroupingPresentationCopy.title}
      </h2>
      <Badge variant="secondary">
        {formatRuntimeGroupingSelectedDatasetCount(selectedDatasetCount)}
      </Badge>
    </div>
  );
}
