import { N4aExportButton } from '@/components/exports/N4aExportButton';
import { useState, useCallback, useEffect, useMemo } from 'react';
import { MlLoadingOverlay } from "@/components/layout/MlLoadingOverlay";
import { motion } from '@/lib/motion';
import { VariableImportanceEmptyState } from '@/components/variable-importance/VariableImportanceEmptyState';
import { VariableImportanceSidebar } from '@/components/variable-importance/VariableImportanceSidebar';
import { ResultsPanel } from '@/components/variable-importance/ResultsPanel';
import {
  loadShapSessionState,
  persistShapSessionState,
} from '@/lib/shapSessionCache';
import { useShapAnalysisJob } from '@/hooks/useShapAnalysisJob';
import { useShapAvailable } from '@/hooks/useBackendCapabilities';
import { usePythonEnv } from '@/context/usePythonEnv';
import type {
  ShapTab,
  Partition,
} from '@/types/shap';
import { DEFAULT_SHAP_SUBSETS, normalizeShapOptions, type ShapAnalysisOptions } from '@/lib/shapVariableImportanceFormData';
import type { ShapExplicitModelRef } from '@/lib/shapAnalysisRequest';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export default function VariableImportance() {
  const persistedSession = useMemo(() => loadShapSessionState(), []);
  const { state: pythonEnv } = usePythonEnv();
  const backendShapAvailable = useShapAvailable();
  const shapPackage = pythonEnv?.selected?.recommended.find((item) => item.name === 'shap');
  const pythonShapAvailable = shapPackage
    ? Boolean(shapPackage.installedVersion && !shapPackage.belowMinimum)
    : backendShapAvailable;

  // Selection state
  const [chainId, setChainId] = useState<string | null>(() => persistedSession?.chainId ?? null);
  const [modelRef, setModelRef] = useState<ShapExplicitModelRef | null>(null);
  const [datasetName, setDatasetName] = useState<string | null>(() => persistedSession?.datasetName ?? null);
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [partition, setPartition] = useState<Partition>(() => persistedSession?.partition ?? 'test');

  // Configuration state
  const [options, setOptions] = useState<ShapAnalysisOptions>(() => normalizeShapOptions(persistedSession?.options));
  const effectiveOptions = useMemo(() =>
    pythonShapAvailable || options.engine === 'native'
      ? options
      : normalizeShapOptions({ ...options, engine: 'native' }),
  [options, pythonShapAvailable]);

  // UI state
  const [activeTab, setActiveTab] = useState<ShapTab>(() => persistedSession?.activeTab ?? 'spectral');
  const {
    jobId,
    results,
    rebinnedData,
    setRebinnedData,
    isSubmitting,
    isRunning,
    error,
    selectedSamples,
    setSelectedSamples,
    progress,
    progressMessage,
    runAnalysis,
  } = useShapAnalysisJob({
    jobId: persistedSession?.jobId,
    results: persistedSession?.results,
    rebinnedData: persistedSession?.rebinnedData,
    isSubmitting: persistedSession?.isSubmitting,
    selectedSamples: persistedSession?.selectedSamples,
  });

  useEffect(() => {
    persistShapSessionState({
      chainId,
      datasetName,
      partition,
      options,
      jobId,
      results,
      rebinnedData,
      isSubmitting,
      activeTab,
      selectedSamples,
    });
  }, [
    activeTab,
    chainId,
    datasetName,
    options,
    isSubmitting,
    jobId,
    partition,
    rebinnedData,
    results,
    selectedSamples,
  ]);

  const handleChainSelect = useCallback((
    newChainId: string | null,
    newDatasetName: string | null,
    newModelRef: ShapExplicitModelRef | null = null,
    newDatasetId: string | null = null,
  ) => {
    // Metadata subsets name columns and values of one dataset: drop them when
    // another dataset is selected (a restored selection keeps its dataset name).
    if (datasetName !== null && newDatasetName !== datasetName) {
      setOptions((current) => ({ ...current, subsets: DEFAULT_SHAP_SUBSETS }));
    }
    setChainId(newChainId);
    setModelRef(newModelRef);
    setDatasetName(newDatasetName);
    setDatasetId(newDatasetId);
  }, [datasetName]);

  const handleRunAnalysis = useCallback(async () => {
    await runAnalysis({ chainId, modelRef, datasetId, partition, options: effectiveOptions });
  }, [chainId, datasetId, modelRef, effectiveOptions, partition, runAnalysis]);

  const canRun = Boolean(chainId && datasetId && !isRunning);

  return (
    <MlLoadingOverlay>
    <motion.div
      className="h-full flex flex-col lg:flex-row gap-4"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Left Sidebar - Configuration */}
      <motion.aside
        variants={itemVariants}
        className="w-full lg:w-80 lg:shrink-0 space-y-4 lg:overflow-y-auto lg:max-h-[calc(100vh-8rem)]"
      >
        <VariableImportanceSidebar
          chainId={chainId}
          datasetId={datasetId}
          onChainSelect={handleChainSelect}
          partition={partition}
          onPartitionChange={setPartition}
          options={effectiveOptions}
          pythonShapAvailable={pythonShapAvailable}
          onOptionsChange={setOptions}
          error={error}
          isRunning={isRunning}
          canRun={canRun}
          onRunAnalysis={handleRunAnalysis}
          jobId={jobId}
          progress={progress}
          progressMessage={progressMessage}
        />
      </motion.aside>

      {/* Main Content - Results */}
      <motion.main
        variants={itemVariants}
        className="flex-1 min-w-0 lg:overflow-y-auto lg:max-h-[calc(100vh-8rem)]"
      >
        {results && <N4aExportButton filename="shap-analysis" shapJobId={jobId ?? undefined} sections={[
          { id: 'shap', label: 'SHAP analysis', description: 'Full stored contributions, input values, axes and analyzed sample identities', payload: results },
        ]} />}
        {results && jobId ? (
          <ResultsPanel
            results={results}
            jobId={jobId}
            binnedData={rebinnedData}
            onBinnedDataChange={setRebinnedData}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            selectedSamples={selectedSamples}
            onSamplesChange={setSelectedSamples}
          />
        ) : (
          <VariableImportanceEmptyState />
        )}
      </motion.main>
    </motion.div>
    </MlLoadingOverlay>
  );
}
