import { RUNTIME_GROUPING_COPY } from "@/lib/runtimeSplitGrouping";

export function NewExperimentRuntimeGroupingNoSplitterNotice() {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
      {RUNTIME_GROUPING_COPY.noSplitterRun}
    </div>
  );
}
