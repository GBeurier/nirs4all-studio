import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  BarChart3,
  Terminal,
  FileJson,
} from "lucide-react";
import type { PipelineRun } from "@/types/runs";
import { ResultDetailHeader } from "./ResultDetailHeader";
import { ResultDetailJsonTab } from "./ResultDetailJsonTab";
import { ResultDetailLogsTab } from "./ResultDetailLogsTab";
import { ResultDetailMetricsTab } from "./ResultDetailMetricsTab";
import type { ResultDetailTab } from "./resultDetailData";
import { useResultDetailSheetState } from "./useResultDetailSheetState";

interface ResultDetailSheetProps {
  pipeline: PipelineRun | null;
  datasetName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ResultDetailSheet({ pipeline, datasetName, open, onOpenChange }: ResultDetailSheetProps) {
  const {
    activeTab,
    copied,
    handleCopyJson,
    hasMetrics,
    logRows,
    pipelineJson,
    setActiveTab,
  } = useResultDetailSheetState(pipeline);

  if (!pipeline) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-hidden flex flex-col">
        <ResultDetailHeader pipeline={pipeline} datasetName={datasetName} />

        <Separator className="my-4" />

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ResultDetailTab)} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-3 flex-shrink-0">
            <TabsTrigger value="results" className="text-xs">
              <BarChart3 className="h-3.5 w-3.5 mr-1.5" />
              Metrics
            </TabsTrigger>
            <TabsTrigger value="json" className="text-xs">
              <FileJson className="h-3.5 w-3.5 mr-1.5" />
              JSON
            </TabsTrigger>
            <TabsTrigger value="logs" className="text-xs">
              <Terminal className="h-3.5 w-3.5 mr-1.5" />
              Logs
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 mt-4">
            <ResultDetailMetricsTab
              pipeline={pipeline}
              datasetName={datasetName}
              hasMetrics={hasMetrics}
            />
            <ResultDetailJsonTab
              pipelineJson={pipelineJson}
              copied={copied}
              onCopyJson={handleCopyJson}
            />
            <ResultDetailLogsTab
              logRows={logRows}
              isRunning={pipeline.status === "running"}
            />
          </ScrollArea>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
