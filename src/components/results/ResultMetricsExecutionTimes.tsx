import { Clock } from "lucide-react";
import type { ResultExecutionTimeRow } from "./resultDetailData";

interface ResultMetricsExecutionTimesProps {
  rows: ResultExecutionTimeRow[];
}

export function ResultMetricsExecutionTimes({ rows }: ResultMetricsExecutionTimesProps) {
  return (
    <div className="p-3 rounded-lg border">
      <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
        <Clock className="h-4 w-4 text-muted-foreground" />
        Execution Times
      </h4>
      <div className="space-y-2 text-sm">
        {rows.map((row) => (
          <div key={row.id} className="flex justify-between">
            <span className="text-muted-foreground">{row.label}</span>
            <span>{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
