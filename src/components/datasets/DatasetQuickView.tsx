/**
 * DatasetQuickView - Inline panel for quick dataset preview.
 *
 * This component owns data fetching, local source/partition state, and panel
 * navigation. Presentation sections live in DatasetQuickViewSections.tsx so
 * future multimodal/data-view previews can add cards without growing this
 * orchestration surface.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "@/lib/motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildTargetHistogramData } from "./charts/targetHistogramData";
import { getPartitionTheme } from "./partitionTheme";
import { useDatasetPreviewQuery } from "@/hooks/useDatasetQueries";
import { useMlReadiness } from "@/context/useMlReadiness";
import { formatWavelengthUnit } from "@/components/playground/visualizations/chartConfig";
import {
  deriveQuickViewLoadState,
  getEffectivePartition,
  getQuickViewCounts,
  getQuickViewHasTest,
  getWavelengthUnitSuffix,
  selectSpectraPreview,
  selectTargetDistribution,
} from "./DatasetQuickViewData";
import {
  DatasetQuickViewFooter,
  DatasetQuickViewHeader,
  DatasetQuickViewOverviewTab,
  DatasetQuickViewSpectraTab,
  DatasetQuickViewStats,
  DatasetQuickViewTargetsTab,
} from "./DatasetQuickViewSections";
import type { Dataset, PartitionKey } from "@/types/datasets";

interface DatasetQuickViewProps {
  dataset: Dataset | null;
  onClose: () => void;
  onEdit?: (dataset: Dataset) => void;
}

export function DatasetQuickView({
  dataset,
  onClose,
  onEdit,
}: DatasetQuickViewProps) {
  const navigate = useNavigate();
  const { workspaceReady } = useMlReadiness();
  const [selectedSource, setSelectedSource] = useState(0);
  const [partition, setPartition] = useState<PartitionKey>("all");

  const {
    data: preview,
    isLoading: queryLoading,
    isFetching,
    error: queryError,
    refetch,
  } = useDatasetPreviewQuery(dataset?.id, 100);

  const { waitingForWorkspace, loading, error } = deriveQuickViewLoadState({
    datasetId: dataset?.id,
    workspaceReady,
    preview,
    queryLoading,
    isFetching,
    queryError,
  });

  useEffect(() => {
    setSelectedSource(0);
    setPartition("all");
  }, [dataset?.id]);

  const counts = dataset
    ? getQuickViewCounts(dataset, preview)
    : {
        numSamples: undefined,
        numFeatures: undefined,
        nSources: 1,
        trainCount: undefined,
        testCount: undefined,
      };
  const { trainCount, testCount } = counts;
  const hasTest = getQuickViewHasTest(preview, testCount);
  const effectivePartition = getEffectivePartition(partition, hasTest);
  const partitionTheme = getPartitionTheme(effectivePartition);

  const spectraData = useMemo(
    () => selectSpectraPreview(preview, selectedSource, effectivePartition),
    [preview, selectedSource, effectivePartition],
  );
  const distribution = useMemo(
    () => selectTargetDistribution(preview, effectivePartition),
    [preview, effectivePartition],
  );
  const histogramData = useMemo(() => buildTargetHistogramData(distribution), [distribution]);

  const headerUnit = preview?.summary?.header_unit;
  const wavelengthUnitSymbol = formatWavelengthUnit(headerUnit);
  const wavelengthUnitSuffix = getWavelengthUnitSuffix(wavelengthUnitSymbol);

  if (!dataset) return null;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={dataset.id}
        initial={{ opacity: 0, width: 0 }}
        animate={{ opacity: 1, width: 480 }}
        exit={{ opacity: 0, width: 0 }}
        transition={{ duration: 0.2 }}
        className="flex-shrink-0 overflow-hidden"
      >
        <div className="max-h-[calc(100vh-6rem)] rounded-xl border border-border bg-card overflow-hidden flex flex-col">
          <DatasetQuickViewHeader dataset={dataset} onClose={onClose} />
          <DatasetQuickViewStats dataset={dataset} counts={counts} />

          <Tabs defaultValue="overview" className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="px-4 pt-2 pb-0 border-b border-border bg-muted/20 flex-shrink-0">
              <TabsList className="w-full grid grid-cols-3 bg-transparent h-10 p-0 border-none">
                <DatasetQuickViewTabTrigger value="overview">Overview</DatasetQuickViewTabTrigger>
                <DatasetQuickViewTabTrigger value="spectra">Spectra</DatasetQuickViewTabTrigger>
                <DatasetQuickViewTabTrigger value="targets">Targets & Labels</DatasetQuickViewTabTrigger>
              </TabsList>
            </div>

            <div className="flex-1 min-h-0 relative">
              <ScrollArea className="absolute inset-0 h-full w-full">
                <div className="p-4 space-y-4">
                  <DatasetQuickViewOverviewTab
                    dataset={dataset}
                    preview={preview}
                    spectraData={spectraData}
                    wavelengthUnitSymbol={wavelengthUnitSymbol}
                    wavelengthUnitSuffix={wavelengthUnitSuffix}
                    waitingForWorkspace={waitingForWorkspace}
                    loading={loading}
                    error={error}
                    onRetry={() => refetch()}
                  />
                  <DatasetQuickViewSpectraTab
                    preview={preview}
                    loading={loading}
                    error={error}
                    spectraData={spectraData}
                    headerUnit={headerUnit}
                    selectedSource={selectedSource}
                    onSelectedSourceChange={setSelectedSource}
                    partition={effectivePartition}
                    onPartitionChange={setPartition}
                    hasTest={hasTest}
                    trainCount={trainCount}
                    testCount={testCount}
                    partitionTheme={partitionTheme}
                  />
                  <DatasetQuickViewTargetsTab
                    loading={loading}
                    error={error}
                    distribution={distribution}
                    histogramData={histogramData}
                    partition={effectivePartition}
                    onPartitionChange={setPartition}
                    hasTest={hasTest}
                    trainCount={trainCount}
                    testCount={testCount}
                    partitionTheme={partitionTheme}
                  />
                </div>
              </ScrollArea>
            </div>
          </Tabs>

          <DatasetQuickViewFooter
            dataset={dataset}
            onEdit={onEdit}
            onOpenDetails={(selectedDataset) => navigate(`/datasets/${selectedDataset.id}`)}
          />
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function DatasetQuickViewTabTrigger({
  value,
  children,
}: {
  value: string;
  children: ReactNode;
}) {
  return (
    <TabsTrigger
      value={value}
      className="data-[state=active]:bg-background data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:rounded-none rounded-none border-b-2 border-transparent h-full px-4 text-sm font-medium"
    >
      {children}
    </TabsTrigger>
  );
}
