import { Archive, Download } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  buildRuntimeNativeResultsAffordance,
  type RuntimeNativeResultsAffordanceInput,
} from "@/ui/runtime";

export function NativeResultsExportAffordance({
  className,
  ...input
}: RuntimeNativeResultsAffordanceInput & {
  className?: string;
}) {
  const { t } = useTranslation();
  const view = buildRuntimeNativeResultsAffordance(input);
  const nativeResultsLabel = !view.hasNativeResults
    ? t("runs.runtime.nativeNotAttached")
    : view.artifactCount == null
      ? t("runs.runtime.nativeResults")
      : t("runs.runtime.nativeArtifacts", { count: view.artifactCount });
  const exportLabel = input.exportLabel
    ?? t(input.hasRefit ? "runs.runtime.exportFinalModel" : "runs.runtime.exportModel");
  const exportDescription = input.exportDescription
    ?? (input.hasRefit ? t("runs.runtime.exportFinalModelHint") : null);
  const disabledReason = input.disabledReason
    ?? (view.hasNativeResults ? null : t("runs.runtime.nativeNotAttachedHint"));

  return (
    <div className={cn("rounded-lg border p-3", className)}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Archive className="h-3.5 w-3.5" />
          {t("runs.runtime.analysisResults")}
        </div>
        <Badge
          variant={view.hasNativeResults ? "secondary" : "outline"}
          className="text-[10px]"
        >
          {nativeResultsLabel}
        </Badge>
      </div>

      <Button variant="outline" size="sm" className="w-full" disabled={view.disabled}>
        <Download className="mr-1.5 h-3.5 w-3.5" />
        {exportLabel}
      </Button>

      {(disabledReason || exportDescription) && (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          {disabledReason ?? exportDescription}
        </p>
      )}
    </div>
  );
}
