import { AlertCircle } from "lucide-react";

import {
  RUNTIME_GROUPING_COPY,
  type SelectedPipelinesRuntimeGrouping,
} from "@/lib/runtimeSplitGrouping";

export interface NewExperimentRuntimeGroupingConflictNoticeProps {
  conflictingPipelines: SelectedPipelinesRuntimeGrouping["conflictingPipelines"];
}

export function NewExperimentRuntimeGroupingConflictNotice({
  conflictingPipelines,
}: NewExperimentRuntimeGroupingConflictNoticeProps) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 text-destructive" />
        <div className="space-y-2 text-sm">
          <p className="font-medium text-destructive">{RUNTIME_GROUPING_COPY.conflictTitle}</p>
          <p className="text-muted-foreground">{RUNTIME_GROUPING_COPY.conflictDescription}</p>
          {conflictingPipelines.map((pipeline) => (
            <p key={pipeline.id} className="text-xs text-muted-foreground">
              {pipeline.name}: {pipeline.steps.join(", ")}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
