import { BarChart3, Database, ListTree, Terminal } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  EnrichedDatasetRun,
  EnrichedRun,
  WorkspaceRunDetail,
  WorkspaceRunPipelineLogEntry,
} from "@/types/enriched-runs";
import { RunDetailLogs } from "./RunDetailLogs";
import { RunDetailOverview } from "./RunDetailOverview";
import { RunDetailPipelines } from "./RunDetailPipelines";
import { type RunDetailTab } from "./RunDetailSheetDisplay";
import { RunDetailSheetDatasets } from "./RunDetailSheetDatasets";

export function RunDetailSheetTabs({
  activeTab,
  onActiveTabChange,
  run,
  datasets,
  detail,
  detailLoading,
  onShowLogs,
  onShowPipelines,
  selectedPipelineId,
  onSelectedPipelineIdChange,
  logs,
  logsLoading,
  selectedMetrics,
  workspaceId,
  status,
}: {
  activeTab: RunDetailTab;
  onActiveTabChange: (tab: RunDetailTab) => void;
  run: EnrichedRun;
  datasets: EnrichedDatasetRun[];
  detail: WorkspaceRunDetail | null;
  detailLoading: boolean;
  onShowLogs: (pipelineId?: string) => void;
  onShowPipelines: () => void;
  selectedPipelineId: string | null;
  onSelectedPipelineIdChange: (pipelineId: string) => void;
  logs: WorkspaceRunPipelineLogEntry[];
  logsLoading: boolean;
  selectedMetrics: string[];
  workspaceId: string;
  status: string;
}) {
  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => onActiveTabChange(value as RunDetailTab)}
      className="flex flex-1 flex-col overflow-hidden"
    >
      <TabsList className="grid w-full grid-cols-2 gap-1 sm:grid-cols-4 flex-shrink-0">
        <TabsTrigger value="overview" className="text-xs">
          <BarChart3 className="mr-1.5 h-3.5 w-3.5" />
          Overview
        </TabsTrigger>
        <TabsTrigger value="pipelines" className="text-xs">
          <ListTree className="mr-1.5 h-3.5 w-3.5" />
          Pipelines
        </TabsTrigger>
        <TabsTrigger value="logs" className="text-xs">
          <Terminal className="mr-1.5 h-3.5 w-3.5" />
          Logs
        </TabsTrigger>
        <TabsTrigger value="datasets" className="text-xs">
          <Database className="mr-1.5 h-3.5 w-3.5" />
          Datasets
        </TabsTrigger>
      </TabsList>

      <ScrollArea className="mt-4 flex-1">
        <TabsContent value="overview" className="m-0">
          <RunDetailOverview
            run={run}
            datasets={datasets}
            detail={detail}
            detailLoading={detailLoading}
            onShowLogs={onShowLogs}
            onShowPipelines={onShowPipelines}
          />
        </TabsContent>

        <TabsContent value="pipelines" className="m-0">
          <RunDetailPipelines
            detail={detail}
            detailLoading={detailLoading}
            onShowLogs={onShowLogs}
          />
        </TabsContent>

        <TabsContent value="logs" className="m-0">
          <RunDetailLogs
            detail={detail}
            selectedPipelineId={selectedPipelineId}
            onSelectedPipelineIdChange={onSelectedPipelineIdChange}
            logs={logs}
            logsLoading={logsLoading}
          />
        </TabsContent>

        <TabsContent value="datasets" className="m-0">
          <RunDetailSheetDatasets
            datasets={datasets}
            selectedMetrics={selectedMetrics}
            runId={run.run_id}
            workspaceId={workspaceId}
            status={status}
          />
        </TabsContent>
      </ScrollArea>
    </Tabs>
  );
}
