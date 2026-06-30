import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getResultExportModelDescription,
  getResultExportModelLabel,
} from "./resultDetailData";

interface ResultMetricsExportActionProps {
  hasRefit: boolean | undefined;
}

export function ResultMetricsExportAction({ hasRefit }: ResultMetricsExportActionProps) {
  const description = getResultExportModelDescription(hasRefit);

  return (
    <div className="p-3 rounded-lg border">
      <Button variant="outline" size="sm" className="w-full">
        <Download className="h-3.5 w-3.5 mr-1.5" />
        {getResultExportModelLabel(hasRefit)}
      </Button>
      {description && (
        <p className="text-xs text-muted-foreground mt-2 text-center">
          {description}
        </p>
      )}
    </div>
  );
}
