import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Play, Clock, CheckCircle2, AlertCircle, RefreshCw, Layers, Plus,
} from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { RunItem } from "@/components/runs/RunItem";
import { RunDetailSheet } from "@/components/runs/RunDetailSheet";
import { ProjectFilter } from "@/components/runs/ProjectFilter";
import { NoWorkspaceState, EmptyState, CardSkeleton } from "@/components/ui/state-display";
import type { EnrichedRun } from "@/types/enriched-runs";
import {
  listRuns,
  getLinkedWorkspaces,
  getEnrichedRuns,
} from "@/api/client";

export default function Runs() {
  const { t } = useTranslation();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [detailRun, setDetailRun] = useState<EnrichedRun | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Fetch linked workspaces
  const { data: workspacesData } = useQuery({
    queryKey: ["linked-workspaces"],
    queryFn: getLinkedWorkspaces,
    staleTime: 30000,
  });

  const activeWorkspaceId = workspacesData?.active_workspace_id;

  // Primary: Enriched runs from DuckDB store
  const {
    data: enrichedData,
    isLoading: isLoadingEnriched,
  } = useQuery({
    queryKey: ["enriched-runs", activeWorkspaceId, selectedProjectId],
    queryFn: () => getEnrichedRuns(activeWorkspaceId!, selectedProjectId ?? undefined),
    enabled: !!activeWorkspaceId,
    staleTime: 30000,
    refetchInterval: 30000,
  });

  // Overlay: Active run status (for running/queued real-time updates)
  const { data: activeRunsData } = useQuery({
    queryKey: ["runs"],
    queryFn: listRuns,
    staleTime: 5000,
    refetchInterval: 10000,
  });

  // Merge enriched + active
  const runs = useMemo(() => {
    const enriched = enrichedData?.runs || [];
    const activeRuns = activeRunsData?.runs || [];

    // Build a set of known enriched run IDs
    const enrichedIds = new Set(enriched.map((r) => r.run_id));

    // Active runs that are NOT in the enriched list (e.g., just started, not yet in DuckDB).
    // Only include running/queued — completed/failed runs should already be in DuckDB enriched data.
    const activeOnlyRuns: EnrichedRun[] = activeRuns
      .filter((ar) =>
        !enrichedIds.has(ar.id) &&
        !enrichedIds.has(ar.store_run_id || "") &&
        (ar.status === "running" || ar.status === "queued")
      )
      .map((ar): EnrichedRun => ({
        run_id: ar.id,
        name: ar.name,
        status: ar.status,
        project_id: null,
        created_at: ar.created_at,
        completed_at: ar.completed_at || null,
        duration_seconds: null,
        artifact_size_bytes: 0,
        datasets_count: ar.datasets?.length || 0,
        pipeline_runs_count: ar.total_pipelines || 0,
        final_models_count: 0,
        total_models_trained: 0,
        total_folds: 0,
        datasets: [],
      }));

    // Enriched runs with active status overlay
    const merged = enriched.map((er) => {
      const activeMatch = activeRuns.find(
        (ar) => ar.id === er.run_id || ar.store_run_id === er.run_id
      );
      if (activeMatch && (activeMatch.status === "running" || activeMatch.status === "queued")) {
        return { ...er, status: activeMatch.status };
      }
      return er;
    });

    return [...activeOnlyRuns, ...merged];
  }, [enrichedData, activeRunsData]);

  const isLoading = isLoadingEnriched;
  const hasActiveWorkspace = !!activeWorkspaceId;

  // Stats
  const runningCount = runs.filter((r) => r.status === "running").length;
  const queuedCount = runs.filter((r) => r.status === "queued").length;
  const completedCount = runs.filter((r) => r.status === "completed").length;
  const failedCount = runs.filter((r) => r.status === "failed").length;
  const totalPipelines = runs.reduce((acc, r) => acc + r.pipeline_runs_count, 0);

  const handleViewDetails = (enrichedRun: EnrichedRun) => {
    setDetailRun(enrichedRun);
    setSheetOpen(true);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("runs.title")}</h1>
          <p className="text-muted-foreground">{t("runs.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <ProjectFilter
            selectedProjectId={selectedProjectId}
            onProjectChange={setSelectedProjectId}
          />
          <Button asChild>
            <Link to="/editor">
              <Plus className="h-4 w-4 mr-2" />
              {t("runs.newRun")}
            </Link>
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-chart-2/10">
            <RefreshCw className={cn("h-5 w-5 text-chart-2", runningCount > 0 && "animate-spin")} />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{t("runs.stats.running")}</p>
            <p className="text-2xl font-bold text-foreground">{runningCount}</p>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-muted/50">
            <Clock className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{t("runs.stats.queued")}</p>
            <p className="text-2xl font-bold text-foreground">{queuedCount}</p>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-chart-1/10">
            <CheckCircle2 className="h-5 w-5 text-chart-1" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{t("runs.stats.completed")}</p>
            <p className="text-2xl font-bold text-foreground">{completedCount}</p>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-destructive/10">
            <AlertCircle className="h-5 w-5 text-destructive" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{t("runs.stats.failed")}</p>
            <p className="text-2xl font-bold text-foreground">{failedCount}</p>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Layers className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{t("runs.stats.totalPipelines")}</p>
            <p className="text-2xl font-bold text-foreground">{totalPipelines}</p>
          </div>
        </CardContent></Card>
      </div>

      {/* Runs List */}
      <div className="space-y-4">
        {isLoading ? (
          <CardSkeleton count={3} />
        ) : !hasActiveWorkspace ? (
          <NoWorkspaceState
            title={t("runs.noWorkspace", { defaultValue: "No workspace linked" })}
            description={t("runs.noWorkspaceHint", { defaultValue: "Link a nirs4all workspace to see your runs and training results. Go to Settings to link a workspace directory." })}
          />
        ) : runs.length === 0 ? (
          <EmptyState
            icon={Play}
            title={t("runs.empty")}
            description={t("runs.emptyHint")}
            action={{ label: t("runs.newRun"), href: "/editor" }}
          />
        ) : (
          runs.map((run) => (
            <RunItem
              key={run.run_id}
              run={run}
              onViewDetails={handleViewDetails}
              workspaceId={activeWorkspaceId!}
            />
          ))
        )}
      </div>

      <RunDetailSheet
        run={detailRun}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        workspaceId={activeWorkspaceId!}
      />
    </div>
  );
}
