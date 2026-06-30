import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion } from "@/lib/motion";
import {
  ArrowUpDown,
  Clock3,
  LayoutGrid,
  List,
  Plus,
  Search,
  Sparkles,
  Star,
  Upload,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InlineError } from "@/components/ui/state-display";
import { cn } from "@/lib/utils";
import {
  pipelinesContainerVariants,
  pipelinesItemVariants,
} from "./PipelinesPageAnimations";
import type { SortBy, ViewMode } from "@/types/pipelines";

export type PageView = "my-pipelines" | "favorites" | "templates" | "recent";

interface PipelinesPageHeaderProps {
  newPipelineLabel: string;
  onImportClick: () => void;
  onSearchChange: (query: string) => void;
  onViewModeChange: (viewMode: ViewMode) => void;
  pageView: PageView;
  searchQuery: string;
  viewMode: ViewMode;
}

export function PipelinesPageHeader({
  newPipelineLabel,
  onImportClick,
  onSearchChange,
  onViewModeChange,
  pageView,
  searchQuery,
  viewMode,
}: PipelinesPageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 border-b border-border/40 pb-4 pt-6",
        "lg:flex-row lg:items-center lg:justify-between"
      )}
    >
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
            onChange={(event) => onSearchChange(event.target.value)}
            className="h-9 pl-9 bg-background/50 border-border/40"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {pageView !== "templates" && pageView !== "recent" && (
          <div className="flex h-9 items-center rounded-md border border-border bg-background/50">
            <button
              type="button"
              onClick={() => onViewModeChange("grid")}
              className={cn(
                "flex h-full w-9 items-center justify-center rounded-l-md",
                "text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground",
                viewMode === "grid" && "bg-muted text-foreground hover:bg-muted"
              )}
              aria-label="Grid view"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange("list")}
              className={cn(
                "flex h-full w-9 items-center justify-center border-l border-border rounded-r-md",
                "text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground",
                viewMode === "list" && "bg-muted text-foreground hover:bg-muted"
              )}
              aria-label="List view"
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        )}

        <Button variant="outline" size="sm" onClick={onImportClick}>
          <Upload className="mr-2 h-4 w-4" />
          Import
        </Button>
        <Button size="sm" asChild>
          <Link to="/pipelines/new">
            <Plus className="mr-2 h-4 w-4" />
            {newPipelineLabel}
          </Link>
        </Button>
      </div>
    </div>
  );
}

interface PipelinesCollectionCounts {
  favorites: number;
  recent: number;
  saved: number;
  templates: number;
}

interface CollectionViewDefinition {
  count: number;
  icon: LucideIcon;
  id: PageView;
  label: string;
}

interface PipelinesPageTabsProps {
  children: ReactNode;
  counts: PipelinesCollectionCounts;
  error: string | null | undefined;
  onRetry: () => void | Promise<void>;
  onSortChange: (sortBy: SortBy) => void;
  onViewChange: (pageView: PageView) => void;
  pageView: PageView;
  sortBy: SortBy;
}

export function PipelinesPageTabs({
  children,
  counts,
  error,
  onRetry,
  onSortChange,
  onViewChange,
  pageView,
  sortBy,
}: PipelinesPageTabsProps) {
  const collectionViews: CollectionViewDefinition[] = [
    {
      id: "my-pipelines",
      icon: Workflow,
      label: "My Pipelines",
      count: counts.saved,
    },
    {
      id: "favorites",
      icon: Star,
      label: "Favorites",
      count: counts.favorites,
    },
    {
      id: "templates",
      icon: Sparkles,
      label: "Templates",
      count: counts.templates,
    },
    {
      id: "recent",
      icon: Clock3,
      label: "Recently Run",
      count: counts.recent,
    },
  ];

  return (
    <Tabs value={pageView} onValueChange={(value) => onViewChange(value as PageView)} className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex w-full hide-scrollbar flex-nowrap overflow-x-auto pb-1 mt-2">
          <TabsList className="h-10 w-auto bg-background/50 border border-border/40">
            {collectionViews.map((view) => {
              const Icon = view.icon;

              return (
                <TabsTrigger
                  key={view.id}
                  value={view.id}
                  className={cn(
                    "flex items-center gap-2 whitespace-nowrap px-4",
                    "data-[state=active]:bg-primary/5 data-[state=active]:text-primary"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {view.label}
                  {view.count > 0 && (
                    <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs font-normal">
                      {view.count}
                    </Badge>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 lg:justify-end">
          {pageView !== "recent" && pageView !== "templates" && (
            <Select value={sortBy} onValueChange={(value) => onSortChange(value as SortBy)}>
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
        <motion.div variants={pipelinesItemVariants} initial="hidden" animate="visible" className="mb-4">
          <InlineError message={error} onRetry={() => void onRetry()} />
        </motion.div>
      )}

      <TabsContent value={pageView} className="m-0 outline-none border-none p-0">
        {children}
      </TabsContent>
    </Tabs>
  );
}

interface PipelinesLoadingStateProps {
  viewMode: ViewMode;
}

export function PipelinesLoadingState({ viewMode }: PipelinesLoadingStateProps) {
  return (
    <motion.div
      variants={pipelinesContainerVariants}
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
          variants={pipelinesItemVariants}
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
}
