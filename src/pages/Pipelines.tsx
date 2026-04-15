import { useState, useCallback, useDeferredValue, useMemo, startTransition } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "@/lib/motion";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpDown,
  ChevronDown,
  Clock3,
  FileEdit,
  LayoutGrid,
  List,
  Plus,
  Search,
  Sparkles,
  Star,
  Upload,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { usePipelines } from "@/hooks/usePipelines";
import { useDraftPipelines } from "@/hooks/useDraftPipelines";
import { getAggregatedPredictions, listRuns } from "@/api/client";
import type { ChainSummary } from "@/types/aggregated-predictions";
import {
  EmptyState,
  InlineError,
  NoPipelinesState,
  SearchEmptyState,
} from "@/components/ui/state-display";
import {
  DraftCard,
  PipelineCard,
  PipelineRow,
  PresetSelector,
  ImportPipelineModal,
  DeletePipelineDialog,
  ExportPipelineDialog,
} from "@/components/pipelines";
import type { Pipeline, PipelinePreset, SortBy, ViewMode } from "@/types/pipelines";
import type { Run } from "@/types/runs";

type PageView = "my-pipelines" | "favorites" | "templates" | "recent";

const RECENT_RUNS_LIMIT = 10;

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

function matchesPipelineSearch(pipeline: Pipeline, query: string) {
  if (!query) return true;
  return (
    pipeline.name.toLowerCase().includes(query) ||
    pipeline.description.toLowerCase().includes(query) ||
    pipeline.tags.some((tag) => tag.toLowerCase().includes(query))
  );
}

function matchesPresetSearch(preset: PipelinePreset, query: string) {
  if (!query) return true;
  return (
    preset.name.toLowerCase().includes(query) ||
    preset.description.toLowerCase().includes(query) ||
    preset.task_type.toLowerCase().includes(query)
  );
}

function sortPipelineItems(pipelines: Pipeline[], sortBy: SortBy) {
  return [...pipelines].sort((a, b) => {
    switch (sortBy) {
      case "name":
        return a.name.localeCompare(b.name);
      case "runCount":
        return (b.runCount ?? 0) - (a.runCount ?? 0);
      case "steps":
        return b.steps.length - a.steps.length;
      case "lastModified":
      default:
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    }
  });
}

function sortPresetItems(presets: PipelinePreset[], sortBy: SortBy) {
  return [...presets].sort((a, b) => {
    switch (sortBy) {
      case "steps":
        return b.steps_count - a.steps_count;
      case "name":
      case "lastModified":
      case "runCount":
      default:
        return a.name.localeCompare(b.name);
    }
  });
}

interface RecentRunEntry {
  pipelineId: string;
  pipelineName: string;
  runId: string;
  storeRunId?: string | null;
  runName: string;
  datasetName: string;
  status: string;
  createdAt: string;
  score?: number | null;
  scoreMetric?: string | null;
}

const LOWER_IS_BETTER = /rmse|mae|mse|loss|error/i;

function scoreOf(chain: ChainSummary): number | null {
  return (
    chain.final_test_score ??
    chain.final_agg_test_score ??
    chain.cv_val_score ??
    chain.cv_test_score ??
    null
  );
}

function pickBestChain(chains: ChainSummary[]): ChainSummary | null {
  if (!chains.length) return null;
  const scored = chains
    .map((c) => ({ chain: c, score: scoreOf(c) }))
    .filter((s): s is { chain: ChainSummary; score: number } => typeof s.score === "number");
  if (!scored.length) return chains[0];
  const metric = scored[0].chain.metric ?? "";
  const lowerIsBetter = LOWER_IS_BETTER.test(metric);
  scored.sort((a, b) => (lowerIsBetter ? a.score - b.score : b.score - a.score));
  return scored[0].chain;
}

function extractRecentRuns(runs: Run[] | undefined, limit: number): RecentRunEntry[] {
  if (!runs?.length) return [];
  const flat: RecentRunEntry[] = [];
  for (const run of runs) {
    const datasets = run.datasets ?? [];
    for (const ds of datasets) {
      for (const p of ds.pipelines ?? []) {
        flat.push({
          pipelineId: p.pipeline_id,
          pipelineName: p.pipeline_name || "Unknown pipeline",
          runId: run.id,
          storeRunId: run.store_run_id ?? null,
          runName: run.name,
          datasetName: ds.dataset_name,
          status: p.status,
          createdAt: run.started_at || run.created_at,
          score: p.score ?? null,
          scoreMetric: p.score_metric ?? null,
        });
      }
    }
  }
  flat.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return flat.slice(0, limit);
}

interface PipelineCollectionProps {
  collectionKey: string;
  onDelete: (pipeline: Pipeline) => void;
  onDuplicate: (pipeline: Pipeline) => void;
  onExport: (pipeline: Pipeline) => void;
  onToggleFavorite: (pipelineId: string) => void;
  pipelines: Pipeline[];
  viewMode: ViewMode;
}

function PipelineCollection({
  collectionKey,
  onDelete,
  onDuplicate,
  onExport,
  onToggleFavorite,
  pipelines,
  viewMode,
}: PipelineCollectionProps) {
  return (
    <AnimatePresence mode="popLayout">
      <motion.div
        key={`${collectionKey}-${viewMode}`}
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className={cn(
          viewMode === "grid"
            ? "grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            : "space-y-2"
        )}
      >
        {pipelines.map((pipeline) =>
          viewMode === "grid" ? (
            <motion.div key={pipeline.id} variants={itemVariants} layout>
              <PipelineCard
                pipeline={pipeline}
                onToggleFavorite={() => onToggleFavorite(pipeline.id)}
                onDuplicate={() => onDuplicate(pipeline)}
                onDelete={() => onDelete(pipeline)}
                onExport={() => onExport(pipeline)}
              />
            </motion.div>
          ) : (
            <motion.div key={pipeline.id} variants={itemVariants} layout>
              <PipelineRow
                pipeline={pipeline}
                onToggleFavorite={() => onToggleFavorite(pipeline.id)}
                onDuplicate={() => onDuplicate(pipeline)}
                onDelete={() => onDelete(pipeline)}
                onExport={() => onExport(pipeline)}
              />
            </motion.div>
          )
        )}
      </motion.div>
    </AnimatePresence>
  );
}

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
  const [templatesExpanded, setTemplatesExpanded] = useState<boolean | null>(null);

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
      presets.filter((preset) => matchesPresetSearch(preset, normalizedQuery)),
      sortBy
    ),
    [presets, normalizedQuery, sortBy]
  );

  const filteredRecentRuns = useMemo(() => {
    if (!normalizedQuery) return recentRuns;
    return recentRuns.filter(
      (r) =>
        r.pipelineName.toLowerCase().includes(normalizedQuery) ||
        r.datasetName.toLowerCase().includes(normalizedQuery) ||
        r.runName.toLowerCase().includes(normalizedQuery)
    );
  }, [recentRuns, normalizedQuery]);

  const visibleDrafts = useMemo(() => {
    if (!normalizedQuery) return drafts;
    return drafts.filter((d) =>
      d.state.pipelineName.toLowerCase().includes(normalizedQuery)
    );
  }, [drafts, normalizedQuery]);

  // Templates strip: default collapsed when user already has pipelines, expanded otherwise.
  const templatesDefaultOpen = savedCount === 0 && drafts.length === 0;
  const templatesOpen = templatesExpanded ?? templatesDefaultOpen;

  const collectionViews = [
    {
      id: "my-pipelines" as const,
      icon: Workflow,
      label: "My Pipelines",
      count: savedCount,
    },
    {
      id: "favorites" as const,
      icon: Star,
      label: "Favorites",
      count: favoritesCount,
    },
    {
      id: "templates" as const,
      icon: Sparkles,
      label: "Templates",
      count: presets.length,
    },
    {
      id: "recent" as const,
      icon: Clock3,
      label: "Recently Run",
      count: recentRuns.length,
    },
  ];

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

  const handlePresetSelect = useCallback(async (presetId: string) => {
    const created = await createFromPreset(presetId);
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
      const candidateRunIds = [...new Set([entry.storeRunId, entry.runId].filter(Boolean))];
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

  const renderLoadingState = () => (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className={cn(
        viewMode === "grid"
          ? "grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          : "space-y-2"
      )}
    >
      {[1, 2, 3, 4].map((index) => (
        <motion.div
          key={index}
          variants={itemVariants}
          className="step-card animate-pulse"
        >
          <div className="h-4 w-24 rounded bg-muted" />
          <div className="mt-3 flex items-start gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted" />
            <div className="flex-1">
              <div className="h-4 w-2/3 rounded bg-muted" />
              <div className="mt-2 h-3 w-full rounded bg-muted" />
              <div className="mt-2 h-3 w-4/5 rounded bg-muted" />
            </div>
          </div>
          <div className="mt-4 h-px bg-muted" />
          <div className="mt-3 h-3 w-1/2 rounded bg-muted" />
        </motion.div>
      ))}
    </motion.div>
  );

  const renderDraftsSection = () => {
    if (visibleDrafts.length === 0) return null;
    return (
      <motion.section
        variants={itemVariants}
        initial="hidden"
        animate="visible"
        className="space-y-3"
      >
        <div className="flex items-center gap-2">
          <FileEdit className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">
            Drafts
          </h2>
          <Badge variant="secondary" className="text-xs">
            {visibleDrafts.length}
          </Badge>
          <span className="ml-2 text-xs text-muted-foreground">
            Unsaved pipelines in this browser — save or discard to keep your workspace tidy.
          </span>
        </div>
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleDrafts.map((draft) => (
            <DraftCard key={draft.id} draft={draft} onDiscard={discardDraft} />
          ))}
        </div>
      </motion.section>
    );
  };

  const renderMyPipelines = () => {
    const hasDrafts = visibleDrafts.length > 0;
    const hasSaved = myPipelinesList.length > 0;

    if (!hasDrafts && !hasSaved) {
      return normalizedQuery ? (
        <SearchEmptyState query={searchQuery} onClear={() => setSearchQuery("")} />
      ) : (
        <NoPipelinesState
          title="No pipelines yet"
          description="Pick a template above or create a blank pipeline to build your first workflow."
        />
      );
    }

    return (
      <div className="space-y-8">
        {renderDraftsSection()}
        {hasSaved && (
          <motion.section variants={itemVariants} initial="hidden" animate="visible" className="space-y-3">
            <div className="flex items-center gap-2">
              <Workflow className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">
                Saved pipelines
              </h2>
              <Badge variant="secondary" className="text-xs">
                {myPipelinesList.length}
              </Badge>
            </div>
            <PipelineCollection
              collectionKey="my-pipelines-saved"
              pipelines={myPipelinesList}
              viewMode={viewMode}
              onToggleFavorite={handleToggleFavorite}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
              onExport={handleExport}
            />
          </motion.section>
        )}
      </div>
    );
  };

  const renderTemplates = () => {
    if (!presetsLoading && templatePipelines.length === 0) {
      return normalizedQuery ? (
        <SearchEmptyState query={searchQuery} onClear={() => setSearchQuery("")} />
      ) : (
        <EmptyState
          icon={Sparkles}
          title="No templates available"
          description="Templates should appear here from the backend preset catalog."
        />
      );
    }

    return (
      <PresetSelector
        presets={templatePipelines}
        onSelect={handlePresetSelect}
        loading={presetsLoading}
      />
    );
  };

  const renderFavorites = () => {
    if (!favoritePipelines.length) {
      return normalizedQuery ? (
        <SearchEmptyState query={searchQuery} onClear={() => setSearchQuery("")} />
      ) : (
        <EmptyState
          icon={Star}
          title="No favorites yet"
          description="Star the pipelines you revisit often and they will stay pinned here."
          action={{ label: "Open My Pipelines", onClick: () => setCollectionView("my-pipelines") }}
        />
      );
    }

    return (
      <PipelineCollection
        collectionKey="favorites"
        pipelines={favoritePipelines}
        viewMode={viewMode}
        onToggleFavorite={handleToggleFavorite}
        onDuplicate={handleDuplicate}
        onDelete={handleDelete}
        onExport={handleExport}
      />
    );
  };

  const renderRecentRuns = () => {
    if (!filteredRecentRuns.length) {
      return normalizedQuery ? (
        <SearchEmptyState query={searchQuery} onClear={() => setSearchQuery("")} />
      ) : (
        <EmptyState
          icon={Clock3}
          title="No recent runs"
          description="Launch a run from a pipeline to see its history here."
          action={{ label: "Open My Pipelines", onClick: () => setCollectionView("my-pipelines") }}
        />
      );
    }

    return (
      <motion.ul
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="space-y-2"
      >
        {filteredRecentRuns.map((entry) => (
          <motion.li
            key={`${entry.runId}:${entry.pipelineId}`}
            variants={itemVariants}
            className="step-card flex flex-wrap items-center justify-between gap-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void openBestChain(entry)}
                  className="truncate text-sm font-semibold text-foreground hover:text-primary"
                >
                  {entry.pipelineName}
                </button>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] uppercase",
                    entry.status === "completed" && "border-green-500/40 text-green-600 dark:text-green-400",
                    entry.status === "failed" && "border-destructive/40 text-destructive",
                    entry.status === "running" && "border-amber-500/40 text-amber-600 dark:text-amber-400"
                  )}
                >
                  {entry.status}
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {entry.datasetName} · run {entry.runName} ·{" "}
                {new Date(entry.createdAt).toLocaleString()}
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              {typeof entry.score === "number" && (
                <span className="tabular-nums text-foreground">
                  {entry.scoreMetric ?? "score"}: {entry.score.toFixed(3)}
                </span>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => void openBestChain(entry)}
              >
                Open best chain
              </Button>
            </div>
          </motion.li>
        ))}
      </motion.ul>
    );
  };

  const renderActiveView = () => {
    if (loading) return renderLoadingState();

    switch (pageView) {
      case "favorites":
        return renderFavorites();
      case "templates":
        return renderTemplates();
      case "recent":
        return renderRecentRuns();
      case "my-pipelines":
      default:
        return renderMyPipelines();
    }
  };

  const showTemplatesStrip = pageView === "my-pipelines";

  return (
    <div className="space-y-6 pb-8 text-foreground container mx-auto">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between border-b border-border/40 pb-4 pt-6">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold tracking-tight">Pipelines</h1>
          <div className="relative w-full sm:w-[240px] ml-4">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={
                pageView === "templates"
                  ? "Search templates..."
                  : pageView === "recent"
                  ? "Search runs..."
                  : "Search pipelines..."
              }
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="h-9 pl-9 bg-background/50 border-border/40"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {pageView !== "templates" && pageView !== "recent" && (
            <div className="flex h-9 items-center rounded-md border border-border bg-background/50">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={cn(
                  "flex h-full w-9 items-center justify-center rounded-l-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground",
                  viewMode === "grid" && "bg-muted text-foreground hover:bg-muted"
                )}
                aria-label="Grid view"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={cn(
                  "flex h-full w-9 items-center justify-center border-l border-border rounded-r-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground",
                  viewMode === "list" && "bg-muted text-foreground hover:bg-muted"
                )}
                aria-label="List view"
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          )}

          <Button variant="outline" size="sm" onClick={() => setImportModalOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Import
          </Button>
          <Button size="sm" asChild>
            <Link to="/pipelines/new">
              <Plus className="mr-2 h-4 w-4" />
              {t("pipelines.newPipeline")}
            </Link>
          </Button>
        </div>
      </div>

      {showTemplatesStrip && (templatePipelines.length > 0 || presetsLoading) && (
        <section className="rounded-xl border border-border/40 bg-background/40">
          <button
            type="button"
            onClick={() => setTemplatesExpanded(!templatesOpen)}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30"
            aria-expanded={templatesOpen}
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-foreground">
                Start from a template
              </span>
              {!presetsLoading && (
                <Badge variant="secondary" className="text-xs">
                  {templatePipelines.length}
                </Badge>
              )}
            </div>
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                templatesOpen && "rotate-180"
              )}
            />
          </button>
          {templatesOpen && (
            <div className="border-t border-border/40 px-4 py-3">
              <PresetSelector
                variant="strip"
                presets={templatePipelines.slice(0, 8)}
                onSelect={handlePresetSelect}
                loading={presetsLoading}
                onSeeAll={() => setCollectionView("templates")}
              />
            </div>
          )}
        </section>
      )}

      <Tabs value={pageView} onValueChange={(v) => setCollectionView(v as PageView)} className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex w-full hide-scrollbar flex-nowrap overflow-x-auto pb-1 mt-2">
            <TabsList className="h-10 w-auto bg-background/50 border border-border/40">
              {collectionViews.map(view => (
                <TabsTrigger key={view.id} value={view.id} className="flex items-center gap-2 whitespace-nowrap px-4 data-[state=active]:bg-primary/5 data-[state=active]:text-primary">
                  <view.icon className="h-4 w-4" />
                  {view.label}
                  {view.count > 0 && (
                    <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs font-normal">
                      {view.count}
                    </Badge>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 lg:justify-end">
            {pageView !== "recent" && (
              <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortBy)}>
                <SelectTrigger className="h-9 w-[140px] bg-background/50">
                  <ArrowUpDown className="mr-2 h-4 w-4" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lastModified">Last modified</SelectItem>
                  <SelectItem value="name">Name</SelectItem>
                  <SelectItem value="runCount">Most runs</SelectItem>
                  <SelectItem value="steps">Most steps</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {error && (
          <motion.div variants={itemVariants} initial="hidden" animate="visible" className="mb-4">
            <InlineError message={error} onRetry={() => void handleRefresh()} />
          </motion.div>
        )}

        <TabsContent value={pageView} className="m-0 outline-none border-none p-0">
          {renderActiveView()}
        </TabsContent>
      </Tabs>

      <ImportPipelineModal
        open={importModalOpen}
        onOpenChange={setImportModalOpen}
        onImport={handleImport}
      />

      <DeletePipelineDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        pipeline={selectedPipeline}
        onConfirm={handleConfirmDelete}
      />

      <ExportPipelineDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        pipeline={selectedPipeline}
        jsonContent={exportJson}
      />
    </div>
  );
}
