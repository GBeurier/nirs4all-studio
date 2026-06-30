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
import type {
  ShapTab,
  ExplainerType,
  Partition,
} from '@/types/shap';
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

  // Selection state
  const [chainId, setChainId] = useState<string | null>(() => persistedSession?.chainId ?? null);
  const [modelRef, setModelRef] = useState<ShapExplicitModelRef | null>(null);
  const [datasetName, setDatasetName] = useState<string | null>(() => persistedSession?.datasetName ?? null);
  const [partition, setPartition] = useState<Partition>(() => persistedSession?.partition ?? 'test');

  // Configuration state
  const [explainerType, setExplainerType] = useState<ExplainerType>(() => persistedSession?.explainerType ?? 'auto');

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
      explainerType,
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
    explainerType,
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
  ) => {
    setChainId(newChainId);
    setModelRef(newModelRef);
    setDatasetName(newDatasetName);
  }, []);

  const handleRunAnalysis = useCallback(async () => {
    await runAnalysis({ chainId, modelRef, datasetName, partition, explainerType });
  }, [chainId, datasetName, explainerType, modelRef, partition, runAnalysis]);

  const canRun = Boolean(chainId && datasetName && !isRunning);

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
          onChainSelect={handleChainSelect}
          partition={partition}
          onPartitionChange={setPartition}
          explainerType={explainerType}
          onExplainerTypeChange={setExplainerType}
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
