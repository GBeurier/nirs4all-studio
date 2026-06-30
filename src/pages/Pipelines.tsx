import { useState, useCallback, useDeferredValue, useMemo, startTransition } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePipelines } from "@/hooks/usePipelines";
import { useDraftPipelines } from "@/hooks/useDraftPipelines";
import { getAggregatedPredictions } from "@/api/aggregatedPredictions";
import { listRuns } from "@/api/runs";
import {
  extractRecentRuns,
  filterRecentRuns,
  matchesPipelineSearch,
  matchesPresetSearch,
  pickBestChain,
  sortPipelineItems,
  sortPresetItems,
  type RecentRunEntry,
} from "./pipelinesData";
import {
  PipelinesActiveSection,
  PipelinesModals,
  PipelinesPageHeader,
  PipelinesPageTabs,
  type PageView,
} from "./PipelinesSections";
import type { Pipeline, PipelinePresetVariantId } from "@/types/pipelines";

const RECENT_RUNS_LIMIT = 10;

export default function Pipelines() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    pipelines,
    presets,
    loading,
    presetsLoading,
    error,
    searchQuery,
    setSearchQuery,
    sortBy,
    setSortBy,
    viewMode,
    setViewMode,
    fetchPipelines,
    fetchPresets,
    createFromPreset,
    deletePipeline,
    clonePipeline,
    toggleFavorite,
    exportPipeline,
    importPipeline,
  } = usePipelines();

  const { drafts, discard: discardDraft } = useDraftPipelines();

  const { data: runsData } = useQuery({
    queryKey: ["runs", "recent"],
    queryFn: listRuns,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  const recentRuns = useMemo(
    () => extractRecentRuns(runsData?.runs, RECENT_RUNS_LIMIT),
    [runsData]
  );

  const [pageView, setPageView] = useState<PageView>("my-pipelines");
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [selectedPipeline, setSelectedPipeline] = useState<Pipeline | null>(null);
  const [exportJson, setExportJson] = useState<string | null>(null);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const normalizedQuery = deferredSearchQuery.trim().toLowerCase();

  const managedPipelines = useMemo(
    () => pipelines.filter((pipeline) => pipeline.category !== "preset"),
    [pipelines]
  );

  const savedCount = managedPipelines.length;
  const favoritesCount = managedPipelines.filter((pipeline) => pipeline.isFavorite).length;

  const myPipelinesList = useMemo(
    () => sortPipelineItems(
      managedPipelines.filter((pipeline) => matchesPipelineSearch(pipeline, normalizedQuery)),
      sortBy
    ),
    [managedPipelines, normalizedQuery, sortBy]
  );
  const favoritePipelines = useMemo(
    () => sortPipelineItems(
      managedPipelines.filter(
        (pipeline) => pipeline.isFavorite && matchesPipelineSearch(pipeline, normalizedQuery)
      ),
      sortBy
    ),
    [managedPipelines, normalizedQuery, sortBy]
  );
  const templatePipelines = useMemo(
    () => sortPresetItems(
      presets.filter((preset) => matchesPresetSearch(preset, normalizedQuery))
    ),
    [presets, normalizedQuery]
  );

  const filteredRecentRuns = useMemo(
    () => filterRecentRuns(recentRuns, normalizedQuery),
    [recentRuns, normalizedQuery]
  );

  const visibleDrafts = useMemo(() => {
    if (!normalizedQuery) return drafts;
    return drafts.filter((d) =>
      d.state.pipelineName.toLowerCase().includes(normalizedQuery)
    );
  }, [drafts, normalizedQuery]);

  const handleToggleFavorite = useCallback(async (id: string) => {
    await toggleFavorite(id);
  }, [toggleFavorite]);

  const handleDuplicate = useCallback(async (pipeline: Pipeline) => {
    await clonePipeline(pipeline.id, `${pipeline.name} (Copy)`);
  }, [clonePipeline]);

  const handleDelete = useCallback((pipeline: Pipeline) => {
    setSelectedPipeline(pipeline);
    setDeleteDialogOpen(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!selectedPipeline) return;
    await deletePipeline(selectedPipeline.id);
    setSelectedPipeline(null);
  }, [deletePipeline, selectedPipeline]);

  const handleExport = useCallback((pipeline: Pipeline) => {
    const json = exportPipeline(pipeline.id);
    setSelectedPipeline(pipeline);
    setExportJson(json);
    setExportDialogOpen(true);
  }, [exportPipeline]);

  const handlePresetSelect = useCallback(async (presetId: string, variant: PipelinePresetVariantId) => {
    const created = await createFromPreset(presetId, variant);
    if (!created) {
      toast.error("Failed to create pipeline from template");
      return;
    }
    toast.success("Template added to your workspace", {
      description: `"${created.name}" is ready to edit.`,
    });
    navigate(`/pipelines/${created.id}`);
  }, [createFromPreset, navigate]);

  const handleImport = useCallback(async (jsonString: string) => {
    return await importPipeline(jsonString);
  }, [importPipeline]);

  const handleRefresh = useCallback(async () => {
    await Promise.all([fetchPipelines(), fetchPresets()]);
  }, [fetchPipelines, fetchPresets]);

  const setCollectionView = useCallback((nextView: PageView) => {
    startTransition(() => {
      setPageView(nextView);
    });
  }, []);

  const openBestChain = useCallback(
    async (entry: RecentRunEntry) => {
      const candidateRunIds = [
        ...new Set(
          [entry.storeRunId, entry.runId].filter(
            (runId): runId is string => typeof runId === "string" && runId.length > 0
          )
        ),
      ];
      const filterVariants = [
        { pipeline_id: entry.pipelineId, dataset_name: entry.datasetName },
        {},
      ];

      let lastError: unknown = null;

      for (const runId of candidateRunIds) {
        for (const filters of filterVariants) {
          try {
            const response = await getAggregatedPredictions({
              run_id: runId,
              ...filters,
            });
            const best = pickBestChain(response.predictions);
            if (best?.chain_id) {
              navigate(`/pipelines/new?chainId=${encodeURIComponent(best.chain_id)}`);
              return;
            }
          } catch (err) {
            lastError = err;
          }
        }
      }

      if (lastError) {
        console.error("Failed to resolve best chain:", lastError);
        toast.error("Could not open the best chain for this run.");
        return;
      }

      toast.info("No chain artifacts found for this run.");
    },
    [navigate]
  );

  return (
    <div className="space-y-6 pb-8 text-foreground container mx-auto">
      <PipelinesPageHeader
        pageView={pageView}
        searchQuery={searchQuery}
        viewMode={viewMode}
        newPipelineLabel={t("pipelines.newPipeline")}
        onSearchChange={setSearchQuery}
        onViewModeChange={setViewMode}
        onImportClick={() => setImportModalOpen(true)}
      />

      <PipelinesPageTabs
        pageView={pageView}
        sortBy={sortBy}
        counts={{
          saved: savedCount,
          favorites: favoritesCount,
          templates: presets.length,
          recent: recentRuns.length,
        }}
        error={error}
        onViewChange={setCollectionView}
        onSortChange={setSortBy}
        onRetry={handleRefresh}
      >
        <PipelinesActiveSection
          pageView={pageView}
          loading={loading}
          viewMode={viewMode}
          visibleDrafts={visibleDrafts}
          myPipelinesList={myPipelinesList}
          favoritePipelines={favoritePipelines}
          templatePipelines={templatePipelines}
          filteredRecentRuns={filteredRecentRuns}
          presetsLoading={presetsLoading}
          normalizedQuery={normalizedQuery}
          searchQuery={searchQuery}
          onToggleFavorite={handleToggleFavorite}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
          onExport={handleExport}
          onDiscardDraft={discardDraft}
          onPresetSelect={handlePresetSelect}
          onOpenBestChain={openBestChain}
          onOpenMyPipelines={() => setCollectionView("my-pipelines")}
          onSearchClear={() => setSearchQuery("")}
        />
      </PipelinesPageTabs>

      <PipelinesModals
        importModalOpen={importModalOpen}
        deleteDialogOpen={deleteDialogOpen}
        exportDialogOpen={exportDialogOpen}
        selectedPipeline={selectedPipeline}
        exportJson={exportJson}
        onImportModalOpenChange={setImportModalOpen}
        onDeleteDialogOpenChange={setDeleteDialogOpen}
        onExportDialogOpenChange={setExportDialogOpen}
        onImport={handleImport}
        onConfirmDelete={handleConfirmDelete}
      />
    </div>
  );
}
