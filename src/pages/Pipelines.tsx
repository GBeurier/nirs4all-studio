/**
 * Pipelines Page - Full Implementation
 * Phase 6: Pipelines Library
 *
 * Features:
 * - Grid/List view toggle
 * - Search, filter, and sort
 * - Tabs: All, Favorites, My Pipelines, Presets, Run History
 * - Pipeline cards with actions (edit, duplicate, delete, export)
 * - Import/Export functionality
 * - Preset pipelines section
 */

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "@/lib/motion";
import { Link } from "react-router-dom";
import {
  Plus,
  Search,
  GitBranch,
  Star,
  Clock,
  ArrowUpDown,
  LayoutGrid,
  List,
  Upload,
  FileJson,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { usePipelines } from "@/hooks/usePipelines";
import {
  PipelineCard,
  PipelineRow,
  PresetSelector,
  ImportPipelineModal,
  DeletePipelineDialog,
  ExportPipelineDialog,
  defaultPresets,
} from "@/components/pipelines";
import type { Pipeline, FilterTab, SortBy } from "@/types/pipelines";

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

export default function Pipelines() {
  const { t } = useTranslation();
  const {
    filteredPipelines,
    presets,
    stats,
    loading,
    error,
    searchQuery,
    setSearchQuery,
    activeTab,
    setActiveTab,
    sortBy,
    setSortBy,
    viewMode,
    setViewMode,
    fetchPipelines,
    createFromPreset,
    deletePipeline,
    clonePipeline,
    toggleFavorite,
    exportPipeline,
    importPipeline,
  } = usePipelines();

  // Modal states
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [selectedPipeline, setSelectedPipeline] = useState<Pipeline | null>(null);
  const [exportJson, setExportJson] = useState<string | null>(null);

  // Use API presets if available, otherwise default
  const displayPresets = presets.length > 0 ? presets : defaultPresets;

  // Handlers
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
    if (selectedPipeline) {
      await deletePipeline(selectedPipeline.id);
      setSelectedPipeline(null);
    }
  }, [selectedPipeline, deletePipeline]);

  const handleExport = useCallback((pipeline: Pipeline) => {
    const json = exportPipeline(pipeline.id);
    setSelectedPipeline(pipeline);
    setExportJson(json);
    setExportDialogOpen(true);
  }, [exportPipeline]);

  const handlePresetSelect = useCallback(async (presetId: string) => {
    await createFromPreset(presetId);
  }, [createFromPreset]);

  const handleImport = useCallback(async (jsonString: string) => {
    return await importPipeline(jsonString);
  }, [importPipeline]);

  // Show presets section when viewing "preset" tab or "all" tab with no user pipelines
  const showPresetsSection = activeTab === "preset" ||
    (activeTab === "all" && stats.user === 0);

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      {/* Header */}
      <motion.div
        variants={itemVariants}
        initial="hidden"
        animate="visible"
        className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("pipelines.title")}</h1>
          <p className="mt-1 text-muted-foreground">
            {t("pipelines.subtitle", { total: stats.total, favorites: stats.favorites, withRuns: stats.withRuns })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => fetchPipelines()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={() => setImportModalOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            {t("pipelines.import")}
          </Button>
          <Button asChild>
            <Link to="/pipelines/new">
              <Plus className="mr-2 h-4 w-4" />
              {t("pipelines.newPipeline")}
            </Link>
          </Button>
        </div>
      </motion.div>

      {/* Search, Tabs, Sort, View */}
      <motion.div
        variants={itemVariants}
        initial="hidden"
        animate="visible"
        className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"
      >
        <div className="flex items-center gap-3 flex-1 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t("pipelines.filters.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-muted/50"
            />
          </div>
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as FilterTab)}
          >
            <TabsList className="bg-muted/50">
              <TabsTrigger value="all">{t("pipelines.tabs.all")}</TabsTrigger>
              <TabsTrigger value="favorites" className="gap-1.5">
                <Star className="h-3.5 w-3.5" /> {t("pipelines.tabs.favorites")}
              </TabsTrigger>
              <TabsTrigger value="user">{t("pipelines.tabs.myPipelines")}</TabsTrigger>
              <TabsTrigger value="preset">{t("pipelines.tabs.presets")}</TabsTrigger>
              <TabsTrigger value="history" className="gap-1.5">
                <Clock className="h-3.5 w-3.5" /> {t("pipelines.tabs.history")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="flex items-center gap-2">
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
            <SelectTrigger className="w-40 bg-muted/50">
              <ArrowUpDown className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="lastModified">{t("pipelines.sort.lastModified")}</SelectItem>
              <SelectItem value="name">{t("pipelines.sort.name")}</SelectItem>
              <SelectItem value="runCount">{t("pipelines.sort.mostRuns")}</SelectItem>
              <SelectItem value="steps">{t("pipelines.sort.mostSteps")}</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex border border-border rounded-lg bg-muted/30">
            <button
              onClick={() => setViewMode("grid")}
              className={cn(
                "p-2 rounded-l-lg transition-colors",
                viewMode === "grid"
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={cn(
                "p-2 rounded-r-lg transition-colors",
                viewMode === "list"
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>
      </motion.div>

      {/* Error state */}
      {error && (
        <motion.div
          variants={itemVariants}
          initial="hidden"
          animate="visible"
          className="p-4 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive"
        >
          {error}
        </motion.div>
      )}

      {/* Loading state */}
      {loading && (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className={cn(
            viewMode === "grid"
              ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
              : "space-y-2"
          )}
        >
          {[1, 2, 3, 4].map((i) => (
            <motion.div
              key={i}
              variants={itemVariants}
              className="step-card animate-pulse"
            >
              <div className="h-4 bg-muted rounded w-20 mb-3" />
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 bg-muted rounded-lg" />
                <div className="flex-1">
                  <div className="h-4 bg-muted rounded w-2/3 mb-2" />
                  <div className="h-3 bg-muted rounded w-full" />
                </div>
              </div>
              <div className="h-px bg-muted mt-4" />
              <div className="h-3 bg-muted rounded w-1/3 mt-3" />
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Pipelines Grid/List */}
      {!loading && filteredPipelines.length > 0 && (
        <AnimatePresence mode="popLayout">
          <motion.div
            key={viewMode}
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className={cn(
              viewMode === "grid"
                ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                : "space-y-2"
            )}
          >
            {filteredPipelines.map((pipeline) =>
              viewMode === "grid" ? (
                <motion.div key={pipeline.id} variants={itemVariants} layout>
                  <PipelineCard
                    pipeline={pipeline}
                    onToggleFavorite={() => handleToggleFavorite(pipeline.id)}
                    onDuplicate={() => handleDuplicate(pipeline)}
                    onDelete={() => handleDelete(pipeline)}
                    onExport={() => handleExport(pipeline)}
                  />
                </motion.div>
              ) : (
                <motion.div key={pipeline.id} variants={itemVariants} layout>
                  <PipelineRow
                    pipeline={pipeline}
                    onToggleFavorite={() => handleToggleFavorite(pipeline.id)}
                    onDuplicate={() => handleDuplicate(pipeline)}
                    onDelete={() => handleDelete(pipeline)}
                    onExport={() => handleExport(pipeline)}
                  />
                </motion.div>
              )
            )}
          </motion.div>
        </AnimatePresence>
      )}

      {/* Empty state */}
      {!loading && filteredPipelines.length === 0 && (
        <motion.div
          variants={itemVariants}
          initial="hidden"
          animate="visible"
          className="text-center py-12 border border-dashed border-border/60 rounded-xl bg-muted/10"
        >
          <GitBranch className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-1">
            {searchQuery ? t("pipelines.emptyNoMatch") : t("pipelines.empty")}
          </h3>
          <p className="text-muted-foreground mb-4 max-w-md mx-auto">
            {searchQuery
              ? t("pipelines.emptyHintNoMatch")
              : t("pipelines.emptyHint")}
          </p>
          <div className="flex items-center justify-center gap-3">
            {searchQuery ? (
              <Button variant="ghost" onClick={() => setSearchQuery("")}>
                {t("pipelines.clearSearch")}
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setImportModalOpen(true)}>
                  <FileJson className="mr-2 h-4 w-4" />
                  {t("pipelines.importPipeline")}
                </Button>
                <Button asChild>
                  <Link to="/pipelines/new">
                    <Plus className="mr-2 h-4 w-4" />
                    {t("pipelines.create")}
                  </Link>
                </Button>
              </>
            )}
          </div>
        </motion.div>
      )}

      {/* Preset Pipelines Section */}
      {showPresetsSection && (
        <motion.div
          variants={itemVariants}
          initial="hidden"
          animate="visible"
          className="space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">
              {t("pipelines.presets.title")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("pipelines.presets.description")}
            </p>
          </div>
          <PresetSelector
            presets={displayPresets}
            onSelect={handlePresetSelect}
          />
        </motion.div>
      )}

      {/* Modals */}
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
    </motion.div>
  );
}
