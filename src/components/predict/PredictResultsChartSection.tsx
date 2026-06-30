import type { Dispatch, RefObject, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { Maximize2, Table as TableIcon, Target } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  ChartConfig,
  PartitionDataset,
  TaskKind,
} from "@/components/predictions/viewer/types";

import { PredictChartPanel, type PanelKind } from "./PredictChartPanel";
import {
  type PredictBadgeReadModel,
  type PredictMetricCardReadModel,
  type PredictStatCardReadModel,
  type PredictTableRow,
} from "./predictResultsData";
import { PredictMetricsSection, PredictStatsSection } from "./PredictResultsCards";
import { PredictResultsTable } from "./PredictResultsTable";

interface PredictChartSectionProps {
  availableKinds: PanelKind[];
  chartRef: RefObject<HTMLDivElement | null>;
  config: ChartConfig;
  datasets: PartitionDataset[];
  hasActuals: boolean;
  kind: PanelKind;
  onConfigChange: Dispatch<SetStateAction<ChartConfig>>;
  onConfigReset: () => void;
  onExportChartCsv: () => void;
  onExportPng: (container: HTMLElement | null) => void;
  onKindChange: (next: PanelKind) => void;
  onOpenFullscreen: () => void;
  rows: PredictTableRow[];
  showPartitionColumn: boolean;
  taskKind: TaskKind;
}

export function PredictChartSection({
  availableKinds,
  chartRef,
  config,
  datasets,
  hasActuals,
  kind,
  onConfigChange,
  onConfigReset,
  onExportChartCsv,
  onExportPng,
  onKindChange,
  onOpenFullscreen,
  rows,
  showPartitionColumn,
  taskKind,
}: PredictChartSectionProps) {
  const { t } = useTranslation();

  return (
    <Tabs defaultValue="chart">
      <TabsList>
        <TabsTrigger value="chart" className="gap-1.5">
          <Target className="h-3.5 w-3.5" />
          Chart view
        </TabsTrigger>
        <TabsTrigger value="table" className="gap-1.5">
          <TableIcon className="h-3.5 w-3.5" />
          {t("predict.results.tabs.table")}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="chart" className="mt-3">
        <PredictChartPanel
          ref={chartRef}
          datasets={datasets}
          taskKind={taskKind}
          hasActuals={hasActuals}
          availableKinds={availableKinds}
          kind={kind}
          onKindChange={onKindChange}
          config={config}
          onConfigChange={onConfigChange}
          onConfigReset={onConfigReset}
          onExportPng={() => onExportPng(chartRef.current)}
          onExportCsv={onExportChartCsv}
          onExpand={onOpenFullscreen}
        />
      </TabsContent>

      <TabsContent value="table" className="mt-3">
        <PredictResultsTable
          hasActuals={hasActuals}
          rows={rows}
          showPartitionColumn={showPartitionColumn}
        />
      </TabsContent>
    </Tabs>
  );
}

interface PredictResultsBodyProps extends PredictChartSectionProps {
  hasMetrics: boolean;
  metricCards: PredictMetricCardReadModel[];
  statsCards: PredictStatCardReadModel[];
}

export function PredictResultsBody({
  hasMetrics,
  metricCards,
  statsCards,
  ...chartSectionProps
}: PredictResultsBodyProps) {
  return (
    <CardContent className="space-y-4">
      <PredictMetricsSection cards={metricCards} hasMetrics={hasMetrics} />
      <PredictStatsSection cards={statsCards} />
      <PredictChartSection {...chartSectionProps} />
    </CardContent>
  );
}

interface PredictFullscreenChartDialogProps {
  availableKinds: PanelKind[];
  chartRef: RefObject<HTMLDivElement | null>;
  config: ChartConfig;
  datasets: PartitionDataset[];
  hasActuals: boolean;
  kind: PanelKind;
  onConfigChange: Dispatch<SetStateAction<ChartConfig>>;
  onConfigReset: () => void;
  onExportChartCsv: () => void;
  onExportPng: (container: HTMLElement | null) => void;
  onKindChange: (next: PanelKind) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  subtitleParts: string[];
  taskBadge: PredictBadgeReadModel;
  taskKind: TaskKind;
  title: string;
}

export function PredictFullscreenChartDialog({
  availableKinds,
  chartRef,
  config,
  datasets,
  hasActuals,
  kind,
  onConfigChange,
  onConfigReset,
  onExportChartCsv,
  onExportPng,
  onKindChange,
  onOpenChange,
  open,
  subtitleParts,
  taskBadge,
  taskKind,
  title,
}: PredictFullscreenChartDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88vh] w-[92vw] max-w-[1200px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Maximize2 className="h-4 w-4 text-primary" />
            <span className="truncate">{title}</span>
          </DialogTitle>
          <DialogDescription className="sr-only">
            Fullscreen prediction chart - customize, export PNG or CSV.
          </DialogDescription>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className={taskBadge.className}>
              {taskBadge.label}
            </Badge>
            {subtitleParts.map((part, index) => (
              <span key={`${index}-${part}`}>{index === 0 ? part : `- ${part}`}</span>
            ))}
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col p-4">
          <PredictChartPanel
            ref={chartRef}
            datasets={datasets}
            taskKind={taskKind}
            hasActuals={hasActuals}
            availableKinds={availableKinds}
            kind={kind}
            onKindChange={onKindChange}
            config={config}
            onConfigChange={onConfigChange}
            onConfigReset={onConfigReset}
            onExportPng={() => onExportPng(chartRef.current)}
            onExportCsv={onExportChartCsv}
            isFullscreen
            className="flex-1"
            chartClassName="h-full"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
