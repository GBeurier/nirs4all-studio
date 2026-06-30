import { Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ResultLogLineData, ResultLogLineTone } from "./resultDetailData";

interface ResultDetailLogsPanelProps {
  logRows: ResultLogLineData[];
  isRunning: boolean;
}

const resultDetailLogLabels = {
  title: "Execution Logs",
  download: "Download",
  running: "Processing...",
};

const logToneClasses: Record<ResultLogLineTone, string | undefined> = {
  default: undefined,
  error: "text-destructive",
  info: "text-muted-foreground",
};

export function ResultDetailLogsPanel({ logRows, isRunning }: ResultDetailLogsPanelProps) {
  return (
    <>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{resultDetailLogLabels.title}</span>
        <Button variant="outline" size="sm">
          <Download className="h-3.5 w-3.5 mr-1.5" />
          {resultDetailLogLabels.download}
        </Button>
      </div>

      <div className="rounded-lg border bg-muted/20 p-4 font-mono text-xs space-y-1 max-h-80 overflow-auto">
        <ResultDetailLogRows logRows={logRows} />
        {isRunning && <ResultDetailRunningLogRow />}
      </div>
    </>
  );
}

function ResultDetailLogRows({ logRows }: { logRows: ResultLogLineData[] }) {
  return (
    <>
      {logRows.map((logRow) => (
        <ResultDetailLogRow key={logRow.id} logRow={logRow} />
      ))}
    </>
  );
}

function ResultDetailLogRow({ logRow }: { logRow: ResultLogLineData }) {
  return (
    <div className={cn(logToneClasses[logRow.tone])}>
      {logRow.text}
    </div>
  );
}

function ResultDetailRunningLogRow() {
  return (
    <div className="flex items-center gap-2 text-chart-2">
      <RefreshCw className="h-3 w-3 animate-spin" />
      <span>{resultDetailLogLabels.running}</span>
    </div>
  );
}
