import { useState, useCallback, useDeferredValue, useMemo, startTransition } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "@/lib/motion";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowUpDown,
  Clock3,
  FolderKanban,
  LayoutGrid,
  Library,
  List,
  LucideIcon,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Upload,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  EmptyState,
  InlineError,
  NoPipelinesState,
  SearchEmptyState,
} from "@/components/ui/state-display";
import {
  PipelineCard,
  PipelineRow,
  PresetSelector,
  ImportPipelineModal,
  DeletePipelineDialog,
  ExportPipelineDialog,
} from "@/components/pipelines";
import type { Pipeline, PipelinePreset, SortBy, ViewMode } from "@/types/pipelines";

type PageView = "overview" | "library" | "favorites" | "templates" | "history";

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

interface PipelineSectionProps {
  collectionKey: string;
  description: string;
  onDelete: (pipeline: Pipeline) => void;
  onDuplicate: (pipeline: Pipeline) => void;
  onExport: (pipeline: Pipeline) => void;
  onToggleFavorite: (pipelineId: string) => void;
  pipelines: Pipeline[];
  title: string;
  viewMode: ViewMode;
}

function PipelineSection({
  collectionKey,
  description,
  onDelete,
  onDuplicate,
  onExport,
  onToggleFavorite,
  pipelines,
  title,
  viewMode,
}: PipelineSectionProps) {
  if (pipelines.length === 0) return null;

  return (
    <motion.section variants={itemVariants} initial="hidden" animate="visible" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            <Badge variant="secondary">{pipelines.length}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <PipelineCollection
        collectionKey={collectionKey}
        pipelines={pipelines}
        viewMode={viewMode}
        onToggleFavorite={onToggleFavorite}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
        onExport={onExport}
      />
    </motion.section>
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

  const [pageView, setPageView] = useState<PageView>("overview");
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
  const historyCount = managedPipelines.filter((pipeline) => (pipeline.runCount ?? 0) > 0).length;
  const sharedCount = managedPipelines.filter((pipeline) => pipeline.category === "shared").length;

  const libraryPipelines = useMemo(
    () => sortPipelineItems(managedPipelines.filter((pipeline) => matchesPipelineSearch(pipeline, normalizedQuery)), sortBy),
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
  const myPipelines = useMemo(
    () => sortPipelineItems(
      managedPipelines.filter(
        (pipeline) => pipeline.category === "user" && matchesPipelineSearch(pipeline, normalizedQuery)
      ),
      sortBy
    ),
    [managedPipelines, normalizedQuery, sortBy]
  );
  const sharedPipelines = useMemo(
    () => sortPipelineItems(
      managedPipelines.filter(
        (pipeline) => pipeline.category === "shared" && matchesPipelineSearch(pipeline, normalizedQuery)
      ),
      sortBy
    ),
    [managedPipelines, normalizedQuery, sortBy]
  );
  const historyPipelines = useMemo(
    () => sortPipelineItems(
      managedPipelines.filter(
        (pipeline) => (pipeline.runCount ?? 0) > 0 && matchesPipelineSearch(pipeline, normalizedQuery)
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

  const overviewTemplates = normalizedQuery ? templatePipelines : templatePipelines.slice(0, 3);
  const overviewHasResults =
    overviewTemplates.length > 0 ||
    favoritePipelines.length > 0 ||
    myPipelines.length > 0 ||
    sharedPipelines.length > 0;

  const collectionViews = [
    {
      id: "overview" as const,
      icon: FolderKanban,
      label: "Overview",
      count: savedCount,
      description: "Templates up front, saved pipelines below, favorites pinned.",
    },
    {
      id: "library" as const,
      icon: Library,
      label: "Library",
      count: savedCount,
      description: "Your saved pipelines and anything shared with the workspace.",
    },
    {
      id: "favorites" as const,
      icon: Star,
      label: "Favorites",
      count: favoritesCount,
      description: "Pinned pipelines you revisit often.",
    },
    {
      id: "templates" as const,
      icon: Sparkles,
      label: "Templates",
      count: presets.length,
      description: "Starter workflows. Use Template creates an editable copy.",
    },
    {
      id: "history" as const,
      icon: Clock3,
      label: "History",
      count: historyCount,
      description: "Pipelines that already have run history.",
    },
  ];

  const activeViewMeta = collectionViews.find((view) => view.id === pageView) ?? collectionViews[0];

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
    toast.success("Template added to your library", {
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

  const renderLibrarySections = () => {
    if (!libraryPipelines.length) {
      return normalizedQuery ? (
        <SearchEmptyState query={searchQuery} onClear={() => setSearchQuery("")} />
      ) : (
        <NoPipelinesState
          title="No saved pipelines yet"
          description="Start from a blank pipeline or use a template to create your first working workflow."
        />
      );
    }

    return (
      <div className="space-y-8">
        <PipelineSection
          collectionKey="library-user"
          title="My Pipelines"
          description="Editable pipelines you own and maintain."
          pipelines={myPipelines}
          viewMode={viewMode}
          onToggleFavorite={handleToggleFavorite}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
          onExport={handleExport}
        />
        <PipelineSection
          collectionKey="library-shared"
          title="Shared"
          description="Workspace pipelines shared across collaborators."
          pipelines={sharedPipelines}
          viewMode={viewMode}
          onToggleFavorite={handleToggleFavorite}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
          onExport={handleExport}
        />
      </div>
    );
  };

  const renderOverview = () => {
    if (normalizedQuery && !overviewHasResults) {
      return <SearchEmptyState query={searchQuery} onClear={() => setSearchQuery("")} />;
    }

    return (
      <div className="space-y-8">
        <motion.section variants={itemVariants} initial="hidden" animate="visible" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-foreground">
                  {normalizedQuery ? "Matching templates" : "Start from a template"}
                </h2>
                {!presetsLoading && <Badge variant="secondary">{templatePipelines.length}</Badge>}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Templates stay separate from your library. Click Use Template to create a copy and open it in the editor.
              </p>
            </div>
            <Button variant="ghost" onClick={() => setCollectionView("templates")}>
              Browse all templates
            </Button>
          </div>
          <PresetSelector
            presets={overviewTemplates}
            onSelect={handlePresetSelect}
            loading={presetsLoading}
          />
        </motion.section>

        {!normalizedQuery && savedCount === 0 && (
          <EmptyState
            icon={Workflow}
            title="Your working library is empty"
            description="Use a template to create a pipeline, or start with a blank one if you want full control."
            action={{ label: t("pipelines.newPipeline"), href: "/pipelines/new" }}
            secondaryAction={{ label: "Open templates", onClick: () => setCollectionView("templates") }}
          />
        )}

        <PipelineSection
          collectionKey="overview-favorites"
          title="Favorites"
          description="Pinned pipelines for the work you return to most often."
          pipelines={favoritePipelines}
          viewMode={viewMode}
          onToggleFavorite={handleToggleFavorite}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
          onExport={handleExport}
        />
        <PipelineSection
          collectionKey="overview-user"
          title="My Pipelines"
          description="Editable pipelines you own and can revise freely."
          pipelines={myPipelines}
          viewMode={viewMode}
          onToggleFavorite={handleToggleFavorite}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
          onExport={handleExport}
        />
        <PipelineSection
          collectionKey="overview-shared"
          title="Shared"
          description="Workspace-level pipelines available to the team."
          pipelines={sharedPipelines}
          viewMode={viewMode}
          onToggleFavorite={handleToggleFavorite}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
          onExport={handleExport}
        />
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
      <div className="space-y-4">
        <Card className="border-primary/15 bg-primary/5">
          <CardContent className="flex flex-col gap-3 p-5 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-foreground">Templates</h2>
                {!presetsLoading && <Badge variant="secondary">{templatePipelines.length}</Badge>}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Templates are starter workflows only. Use Template creates a new editable pipeline and opens it immediately.
              </p>
            </div>
            <Badge variant="outline" className="w-fit">
              Presets no longer mix into the library view
            </Badge>
          </CardContent>
        </Card>
        <PresetSelector
          presets={templatePipelines}
          onSelect={handlePresetSelect}
          loading={presetsLoading}
        />
      </div>
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
          action={{ label: "Browse library", onClick: () => setCollectionView("library") }}
        />
      );
    }

    return (
      <PipelineSection
        collectionKey="favorites"
        title="Favorites"
        description="Pinned pipelines from your saved and shared library."
        pipelines={favoritePipelines}
        viewMode={viewMode}
        onToggleFavorite={handleToggleFavorite}
        onDuplicate={handleDuplicate}
        onDelete={handleDelete}
        onExport={handleExport}
      />
    );
  };

  const renderHistory = () => {
    if (!historyPipelines.length) {
      return normalizedQuery ? (
        <SearchEmptyState query={searchQuery} onClear={() => setSearchQuery("")} />
      ) : (
        <EmptyState
          icon={Clock3}
          title="No pipeline history yet"
          description="Pipelines appear here once they have at least one run attached."
          action={{ label: "Open library", onClick: () => setCollectionView("library") }}
        />
      );
    }

    return (
      <PipelineSection
        collectionKey="history"
        title="Run History"
        description="Pipelines with at least one execution in the workspace."
        pipelines={historyPipelines}
        viewMode={viewMode}
        onToggleFavorite={handleToggleFavorite}
        onDuplicate={handleDuplicate}
        onDelete={handleDelete}
        onExport={handleExport}
      />
    );
  };

  const renderActiveView = () => {
    if (loading) return renderLoadingState();

    switch (pageView) {
      case "library":
        return renderLibrarySections();
      case "favorites":
        return renderFavorites();
      case "templates":
        return renderTemplates();
      case "history":
        return renderHistory();
      case "overview":
      default:
        return renderOverview();
    }
  };

  return (
    <div className="space-y-6 pb-8 text-foreground container mx-auto">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between border-b border-border/40 pb-4 pt-6">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold tracking-tight">Pipelines</h1>
          <div className="relative w-full sm:w-[240px] ml-4">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={pageView === "templates" ? "Search templates..." : "Search pipelines..."}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="h-9 pl-9 bg-background/50 border-border/40"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {pageView !== "templates" && (
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
              New Pipeline
            </Link>
          </Button>
        </div>
      </div>

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
