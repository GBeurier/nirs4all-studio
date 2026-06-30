import { motion } from "@/lib/motion";
import { FileEdit, Sparkles, Star, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  EmptyState,
  NoPipelinesState,
  SearchEmptyState,
} from "@/components/ui/state-display";
import { DraftCard, PresetSelector } from "@/components/pipelines";
import type { DraftEntry } from "@/hooks/useDraftPipelines";
import { PipelinesCollectionView } from "./PipelinesCollectionView";
import { RecentRunsSection } from "./PipelinesRecentRunsSection";
import { pipelinesItemVariants } from "./PipelinesPageAnimations";
import { PipelinesLoadingState, type PageView } from "./PipelinesPageChrome";
import type { RecentRunEntry } from "./pipelinesData";
import type {
  Pipeline,
  PipelinePreset,
  PipelinePresetVariantId,
  ViewMode,
} from "@/types/pipelines";

interface PipelineActions {
  onDelete: (pipeline: Pipeline) => void;
  onDuplicate: (pipeline: Pipeline) => void | Promise<void>;
  onExport: (pipeline: Pipeline) => void;
  onToggleFavorite: (pipelineId: string) => void | Promise<void>;
}

interface DraftsSectionProps {
  onDiscardDraft: (draftId: string) => void;
  visibleDrafts: DraftEntry[];
}

function DraftsSection({ onDiscardDraft, visibleDrafts }: DraftsSectionProps) {
  if (visibleDrafts.length === 0) return null;

  return (
    <motion.section
      variants={pipelinesItemVariants}
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
          Unsaved pipelines in this browser - save or discard to keep your workspace tidy.
        </span>
      </div>
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visibleDrafts.map((draft) => (
          <DraftCard key={draft.id} draft={draft} onDiscard={onDiscardDraft} />
        ))}
      </div>
    </motion.section>
  );
}

interface MyPipelinesSectionProps extends PipelineActions {
  normalizedQuery: string;
  onDiscardDraft: (draftId: string) => void;
  onSearchClear: () => void;
  pipelines: Pipeline[];
  searchQuery: string;
  viewMode: ViewMode;
  visibleDrafts: DraftEntry[];
}

function MyPipelinesSection({
  normalizedQuery,
  onDelete,
  onDiscardDraft,
  onDuplicate,
  onExport,
  onSearchClear,
  onToggleFavorite,
  pipelines,
  searchQuery,
  viewMode,
  visibleDrafts,
}: MyPipelinesSectionProps) {
  const hasDrafts = visibleDrafts.length > 0;
  const hasSaved = pipelines.length > 0;

  if (!hasDrafts && !hasSaved) {
    return normalizedQuery ? (
      <SearchEmptyState query={searchQuery} onClear={onSearchClear} />
    ) : (
      <NoPipelinesState
        title="No pipelines yet"
        description="Pick a template above or create a blank pipeline to build your first workflow."
      />
    );
  }

  return (
    <div className="space-y-8">
      <DraftsSection visibleDrafts={visibleDrafts} onDiscardDraft={onDiscardDraft} />
      {hasSaved && (
        <motion.section variants={pipelinesItemVariants} initial="hidden" animate="visible" className="space-y-3">
          <div className="flex items-center gap-2">
            <Workflow className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">
              Saved pipelines
            </h2>
            <Badge variant="secondary" className="text-xs">
              {pipelines.length}
            </Badge>
          </div>
          <PipelinesCollectionView
            collectionKey="my-pipelines-saved"
            pipelines={pipelines}
            viewMode={viewMode}
            onToggleFavorite={onToggleFavorite}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
            onExport={onExport}
          />
        </motion.section>
      )}
    </div>
  );
}

interface TemplatesSectionProps {
  normalizedQuery: string;
  onPresetSelect: (presetId: string, variant: PipelinePresetVariantId) => void | Promise<void>;
  onSearchClear: () => void;
  presetsLoading: boolean;
  searchQuery: string;
  templatePipelines: PipelinePreset[];
}

function TemplatesSection({
  normalizedQuery,
  onPresetSelect,
  onSearchClear,
  presetsLoading,
  searchQuery,
  templatePipelines,
}: TemplatesSectionProps) {
  if (!presetsLoading && templatePipelines.length === 0) {
    return normalizedQuery ? (
      <SearchEmptyState query={searchQuery} onClear={onSearchClear} />
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
      onSelect={(presetId, variant) => void onPresetSelect(presetId, variant)}
      loading={presetsLoading}
    />
  );
}

interface FavoritesSectionProps extends PipelineActions {
  favoritePipelines: Pipeline[];
  normalizedQuery: string;
  onOpenMyPipelines: () => void;
  onSearchClear: () => void;
  searchQuery: string;
  viewMode: ViewMode;
}

function FavoritesSection({
  favoritePipelines,
  normalizedQuery,
  onDelete,
  onDuplicate,
  onExport,
  onOpenMyPipelines,
  onSearchClear,
  onToggleFavorite,
  searchQuery,
  viewMode,
}: FavoritesSectionProps) {
  if (!favoritePipelines.length) {
    return normalizedQuery ? (
      <SearchEmptyState query={searchQuery} onClear={onSearchClear} />
    ) : (
      <EmptyState
        icon={Star}
        title="No favorites yet"
        description="Star the pipelines you revisit often and they will stay pinned here."
        action={{ label: "Open My Pipelines", onClick: onOpenMyPipelines }}
      />
    );
  }

  return (
    <PipelinesCollectionView
      collectionKey="favorites"
      pipelines={favoritePipelines}
      viewMode={viewMode}
      onToggleFavorite={onToggleFavorite}
      onDuplicate={onDuplicate}
      onDelete={onDelete}
      onExport={onExport}
    />
  );
}

interface PipelinesActiveSectionProps extends PipelineActions {
  favoritePipelines: Pipeline[];
  filteredRecentRuns: RecentRunEntry[];
  loading: boolean;
  myPipelinesList: Pipeline[];
  normalizedQuery: string;
  onDiscardDraft: (draftId: string) => void;
  onOpenBestChain: (entry: RecentRunEntry) => void | Promise<void>;
  onOpenMyPipelines: () => void;
  onPresetSelect: (presetId: string, variant: PipelinePresetVariantId) => void | Promise<void>;
  onSearchClear: () => void;
  pageView: PageView;
  presetsLoading: boolean;
  searchQuery: string;
  templatePipelines: PipelinePreset[];
  viewMode: ViewMode;
  visibleDrafts: DraftEntry[];
}

export function PipelinesActiveSection({
  favoritePipelines,
  filteredRecentRuns,
  loading,
  myPipelinesList,
  normalizedQuery,
  onDelete,
  onDiscardDraft,
  onDuplicate,
  onExport,
  onOpenBestChain,
  onOpenMyPipelines,
  onPresetSelect,
  onSearchClear,
  onToggleFavorite,
  pageView,
  presetsLoading,
  searchQuery,
  templatePipelines,
  viewMode,
  visibleDrafts,
}: PipelinesActiveSectionProps) {
  if (loading) return <PipelinesLoadingState viewMode={viewMode} />;

  switch (pageView) {
    case "favorites":
      return (
        <FavoritesSection
          favoritePipelines={favoritePipelines}
          normalizedQuery={normalizedQuery}
          searchQuery={searchQuery}
          viewMode={viewMode}
          onToggleFavorite={onToggleFavorite}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          onExport={onExport}
          onOpenMyPipelines={onOpenMyPipelines}
          onSearchClear={onSearchClear}
        />
      );
    case "templates":
      return (
        <TemplatesSection
          normalizedQuery={normalizedQuery}
          searchQuery={searchQuery}
          templatePipelines={templatePipelines}
          presetsLoading={presetsLoading}
          onPresetSelect={onPresetSelect}
          onSearchClear={onSearchClear}
        />
      );
    case "recent":
      return (
        <RecentRunsSection
          filteredRecentRuns={filteredRecentRuns}
          normalizedQuery={normalizedQuery}
          searchQuery={searchQuery}
          onOpenBestChain={onOpenBestChain}
          onOpenMyPipelines={onOpenMyPipelines}
          onSearchClear={onSearchClear}
        />
      );
    case "my-pipelines":
    default:
      return (
        <MyPipelinesSection
          normalizedQuery={normalizedQuery}
          pipelines={myPipelinesList}
          searchQuery={searchQuery}
          viewMode={viewMode}
          visibleDrafts={visibleDrafts}
          onToggleFavorite={onToggleFavorite}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          onExport={onExport}
          onDiscardDraft={onDiscardDraft}
          onSearchClear={onSearchClear}
        />
      );
  }
}
