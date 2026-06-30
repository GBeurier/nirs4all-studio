import { CheckCircle2, Download, TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import {
  buildPredictionPreviewRows,
  hasActualValues,
  type PredictionResult,
} from "./PredictDialogData";

interface PredictDialogResultsProps {
  result: PredictionResult;
  onExport: () => void;
}

export function PredictDialogResults({
  result,
  onExport,
}: PredictDialogResultsProps) {
  const hasActual = hasActualValues(result);
  const displayCount = Math.min(result.predictions.length, 20);
  const rows = buildPredictionPreviewRows(result, displayCount);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-chart-1" />
            <span className="font-medium">{result.num_samples} predictions</span>
          </div>
          {result.metrics && (
            <div className="flex items-center gap-3 text-sm">
              {result.metrics.r2 != null && (
                <Badge variant="outline" className="gap-1">
                  <TrendingUp className="h-3 w-3" />
                  R² = {(result.metrics.r2 * 100).toFixed(2)}%
                </Badge>
              )}
              {result.metrics.rmse != null && (
                <Badge variant="outline">
                  RMSE = {result.metrics.rmse.toFixed(4)}
                </Badge>
              )}
            </div>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={onExport}>
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </div>

      <Card>
        <ScrollArea className="h-64">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">#</TableHead>
                <TableHead>Prediction</TableHead>
                {hasActual && <TableHead>Actual</TableHead>}
                {hasActual && <TableHead>Difference</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.index}>
                  <TableCell className="text-muted-foreground">{row.index}</TableCell>
                  <TableCell className="font-mono">{row.prediction}</TableCell>
                  {hasActual && (
                    <TableCell className="font-mono">{row.actual ?? "-"}</TableCell>
                  )}
                  {hasActual && (
                    <TableCell
                      className={cn(
                        "font-mono",
                        row.differenceValue !== null && row.differenceValue > 0
                          ? "text-amber-500"
                          : "text-chart-1"
                      )}
                    >
                      {row.difference ?? "-"}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
        {result.predictions.length > displayCount && (
          <div className="p-2 text-center text-xs text-muted-foreground border-t">
            Showing {displayCount} of {result.predictions.length} predictions
          </div>
        )}
      </Card>
    </div>
  );
}
