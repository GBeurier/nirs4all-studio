import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "@/lib/motion";
import {
  clientStorageKeys,
  readClientStorageString,
  writeClientStorageString,
} from "@/lib/clientStorage";
import {
  Database,
  Plus,
  FolderOpen,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DatasetCard,
  DatasetQuickView,
  useDragDrop,
  type DroppedContent,
} from "@/components/datasets";
import type { DatasetScoreInfo } from "@/components/datasets/DatasetCard";
import type { WizardInitialState } from "@/components/datasets/DatasetWizard";
import { useIsDeveloperMode } from "@/context/useDeveloperMode";
import {
  detectUnified,
  detectFilesList,
} from "@/api/datasets";
import {
  useDatasetsQuery,
  useLinkedWorkspacesQuery,
  useDatasetScoresQuery,
} from "@/hooks/useDatasetQueries";
import { useDatasetCatalogActions } from "@/hooks/useDatasetCatalogActions";
import {
  getDatasetCatalogStats,
  getFilteredSortedDatasets,
  type DatasetFilterGroup,
  type DatasetSortDirection,
  type DatasetSortField,
} from "@/lib/datasetCatalog";
import {
  resolveDatasetDrop,
} from "@/lib/datasetDrop";
import type { Dataset, DatasetGroup } from "@/types/datasets";
import {
  DatasetsHeader,
  DatasetsPageMounts,
  DatasetsStatsCards,
  DatasetsToolbar,
  DatasetsWorkspaceInfo,
} from "./DatasetsSections";

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

const EMPTY_DATASETS: Dataset[] = [];
const EMPTY_GROUPS: DatasetGroup[] = [];

export default function Datasets() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Developer mode
  const isDeveloperMode = useIsDeveloperMode();

  // ----------------------------------------------------------------------
  // Server state via React Query
  //
  // Datasets, groups, the active workspace and per-dataset scores are all
  // cached in the global QueryClient (5 min staleTime, 30 min gcTime). This
  // means navigating away and back to /datasets renders cached data
  // immediately and revalidates in the background instead of dropping the
  // page back to a spinner — which was the original "still in loading mode
  // at startup" complaint.
  //
  // The very first navigation is also primed by `prefetchDatasetsList()` in
  // MlReadinessProvider as soon as the FastAPI core is reachable.
  // ----------------------------------------------------------------------
  const datasetsQuery = useDatasetsQuery();
  const linkedWorkspacesQuery = useLinkedWorkspacesQuery();

  const datasets = datasetsQuery.data?.datasets ?? EMPTY_DATASETS;
  const groups = datasetsQuery.data?.groups ?? EMPTY_GROUPS;
  const datasetActions = useDatasetCatalogActions(groups);
  const activeWorkspace = useMemo(
    () => linkedWorkspacesQuery.data?.workspaces.find((ws) => ws.is_active) ?? null,
    [linkedWorkspacesQuery.data]
  );
  const workspacePath = activeWorkspace?.path ?? null;
  const workspaceId = activeWorkspace?.id ?? null;

  // Show the spinner only when we have no cached data at all. After the first
  // load, refetches happen in the background while the previous list stays
  // visible (stale-while-revalidate).
  const loading =
    (datasetsQuery.isLoading || linkedWorkspacesQuery.isLoading) &&
    !datasetsQuery.data;
  const refreshing =
    datasetsQuery.isFetching || linkedWorkspacesQuery.isFetching;
  const loadError =
    (datasetsQuery.error instanceof Error && datasetsQuery.error.message)
    || (linkedWorkspacesQuery.error instanceof Error && linkedWorkspacesQuery.error.message)
    || null;

  // Per-dataset best scores. Gated on workspaceReady inside the hook so the
  // request only fires once the SQLite store is authoritative.
  const datasetScoresQuery = useDatasetScoresQuery(workspaceId);
  const datasetScores = useMemo(() => {
    const scores = new Map<string, DatasetScoreInfo>();
    for (const entry of datasetScoresQuery.data?.datasets ?? []) {
      const matchKey = entry.linked_dataset_id || entry.dataset_name;
      if (!matchKey || entry.best_score == null) continue;
      scores.set(matchKey, {
        score: entry.best_score,
        metric: entry.metric ?? "score",
        model: entry.model_name || undefined,
        isFinal: entry.score_kind === "final",
        cvScore: entry.cv_score ?? undefined,
      });
    }
    return scores;
  }, [datasetScoresQuery.data]);

  // UI state
  const [searchQuery, setSearchQuery] = useState("");
  const [filterGroup, setFilterGroup] = useState<DatasetFilterGroup>("all");

  // Sort state — persisted to localStorage
  const [sortField, setSortField] = useState<DatasetSortField>(() => {
    const saved = readClientStorageString(clientStorageKeys.datasetsSortField);
    return (saved as DatasetSortField) || "linked_at";
  });
  const [sortDirection, setSortDirection] = useState<DatasetSortDirection>(() => {
    const saved = readClientStorageString(clientStorageKeys.datasetsSortDirection);
    return (saved as DatasetSortDirection) || "desc";
  });

  // Persist sort state to localStorage
  useEffect(() => {
    writeClientStorageString(clientStorageKeys.datasetsSortField, sortField);
  }, [sortField]);
  useEffect(() => {
    writeClientStorageString(clientStorageKeys.datasetsSortDirection, sortDirection);
  }, [sortDirection]);

  // Modal state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [syntheticDialogOpen, setSyntheticDialogOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [groupsModalOpen, setGroupsModalOpen] = useState(false);
  const [selectedDataset, setSelectedDataset] = useState<Dataset | null>(null);

  // Quick view state - inline panel
  const [quickViewDataset, setQuickViewDataset] = useState<Dataset | null>(null);

  // Drag-and-drop state
  const [wizardInitialState, setWizardInitialState] = useState<WizardInitialState | undefined>(undefined);

  // Batch scan state
  const [batchScanOpen, setBatchScanOpen] = useState(false);
  const [batchScanPath, setBatchScanPath] = useState("");

  const handleDrop = useCallback(async (content: DroppedContent) => {
    const resolution = await resolveDatasetDrop(content, {
      detectUnified,
      detectFilesList,
    });

    if (resolution.kind === "batch-scan") {
      setBatchScanPath(resolution.path);
      setBatchScanOpen(true);
      return;
    }

    setWizardInitialState(resolution.initialState);
    setWizardOpen(true);
  }, []);

  // Drag-and-drop hook
  const { isDragging, dropType, itemCount } = useDragDrop({
    onDrop: handleDrop,
    disabled: false,
  });

  const normalizedDatasets = datasets;

  // Filter datasets
  const filteredDatasets = useMemo(
    () => getFilteredSortedDatasets({
      datasets: normalizedDatasets,
      groups,
      searchQuery,
      filterGroup,
      sortField,
      sortDirection,
    }),
    [normalizedDatasets, groups, searchQuery, filterGroup, sortField, sortDirection],
  );

  // Stats
  const { totalSamples, hasFeatureCounts, minFeatures, maxFeatures } = useMemo(
    () => getDatasetCatalogStats(normalizedDatasets),
    [normalizedDatasets],
  );

  // Handlers
  const handleSelectWorkspace = () => {
    navigate("/settings?tab=workspaces");
  };

  const handleRefreshAll = async () => {
    await datasetActions.refreshAll();
  };

  const handleEditDataset = (dataset: Dataset) => {
    setSelectedDataset(dataset);
    setEditModalOpen(true);
  };

  const handleDeleteDataset = async (dataset: Dataset) => {
    if (!confirm(`Remove "${dataset.name}" from workspace?`)) return;
    await datasetActions.removeDataset(dataset.id);
    // Clear quick view if deleted dataset was selected
    if (quickViewDataset?.id === dataset.id) {
      setQuickViewDataset(null);
    }
  };

  return (
    <motion.div
      className="space-y-6"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Header */}
      <motion.div variants={itemVariants}>
        <DatasetsHeader
          isDeveloperMode={isDeveloperMode}
          onOpenGroups={() => setGroupsModalOpen(true)}
          onOpenSynthetic={() => setSyntheticDialogOpen(true)}
          onOpenWizard={() => setWizardOpen(true)}
        />
      </motion.div>

      {/* Workspace Info */}
      <motion.div variants={itemVariants}>
        <DatasetsWorkspaceInfo
          workspacePath={workspacePath}
          onSelectWorkspace={handleSelectWorkspace}
        />
      </motion.div>

      {/* Stats */}
      <motion.div variants={itemVariants}>
        <DatasetsStatsCards
          datasetCount={normalizedDatasets.length}
          totalSamples={totalSamples}
          hasFeatureCounts={hasFeatureCounts}
          minFeatures={minFeatures}
          maxFeatures={maxFeatures}
          groupCount={groups.length}
        />
      </motion.div>

      {/* Search and Filter */}
      <motion.div variants={itemVariants}>
        <DatasetsToolbar
          groups={groups}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          filterGroup={filterGroup}
          onFilterGroupChange={setFilterGroup}
          sortField={sortField}
          onSortFieldChange={setSortField}
          sortDirection={sortDirection}
          onSortDirectionChange={setSortDirection}
          refreshing={refreshing}
          onRefreshAll={() => { void handleRefreshAll(); }}
        />
      </motion.div>

      {/* Main Content: List + Quick View Panel */}
      <motion.div variants={itemVariants}>
        {loading ? (
          <Card>
            <CardContent className="p-12">
              <div className="flex flex-col items-center justify-center text-center">
                <RefreshCw className="h-8 w-8 text-muted-foreground animate-spin mb-4" />
                <p className="text-muted-foreground">{t("datasets.loading")}</p>
              </div>
            </CardContent>
          </Card>
        ) : loadError ? (
          <Card>
            <CardContent className="p-12">
              <div className="flex flex-col items-center justify-center text-center">
                <Database className="h-10 w-10 text-destructive mb-4" />
                <h3 className="text-xl font-semibold text-foreground mb-2">
                  Failed to load datasets
                </h3>
                <p className="text-muted-foreground max-w-md mb-6">
                  {loadError}
                </p>
                <Button onClick={handleRefreshAll}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Retry
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : filteredDatasets.length === 0 ? (
          <Card>
            <CardContent className="p-12">
              <div className="flex flex-col items-center justify-center text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted mb-4">
                  <Database className="h-10 w-10 text-muted-foreground" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2">
                  {normalizedDatasets.length === 0 ? t("datasets.empty") : t("datasets.emptyNoMatch")}
                </h3>
                <p className="text-muted-foreground max-w-md mb-6">
                  {normalizedDatasets.length === 0
                    ? t("datasets.emptyHint")
                    : t("datasets.emptyHintNoMatch")}
                </p>
                {normalizedDatasets.length === 0 && (
                  <div className="flex gap-3">
                    {!workspacePath && (
                      <Button variant="outline" onClick={handleSelectWorkspace}>
                        <FolderOpen className="mr-2 h-4 w-4" />
                        {t("datasets.selectWorkspace")}
                      </Button>
                    )}
                    <Button onClick={() => setWizardOpen(true)}>
                      <Plus className="mr-2 h-4 w-4" />
                      {t("datasets.addDataset")}
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="flex gap-6 items-start">
            {/* Dataset List */}
            <div className="flex-1 space-y-3 min-w-0">
              {filteredDatasets.map((dataset) => (
                <DatasetCard
                  key={dataset.id}
                  dataset={dataset}
                  groups={groups}
                  selected={quickViewDataset?.id === dataset.id}
                  bestScore={datasetScores.get(dataset.id) ?? null}
                  onSelect={(ds) => setQuickViewDataset(ds)}
                  onPreview={(ds) => setQuickViewDataset(ds)}
                  onEdit={() => handleEditDataset(dataset)}
                  onDelete={() => handleDeleteDataset(dataset)}
                  onRefresh={() => datasetActions.refreshDatasetById(dataset.id)}
                  onAssignGroup={(ds, groupId) => datasetActions.assignGroup(ds, groupId)}
                />
              ))}
            </div>

            {/* Quick View Panel (sticky to stay visible when scrolling) */}
            {quickViewDataset && (
              <div className="sticky top-4">
                <DatasetQuickView
                  dataset={quickViewDataset}
                  onClose={() => setQuickViewDataset(null)}
                  onEdit={(ds) => {
                    setSelectedDataset(ds);
                    setEditModalOpen(true);
                  }}
                />
              </div>
            )}
          </div>
        )}
      </motion.div>

      <DatasetsPageMounts
        onAddDataset={datasetActions.addDataset}
        wizardOpen={wizardOpen}
        onWizardOpenChange={(open) => {
          setWizardOpen(open);
          // Clear initial state when wizard closes
          if (!open) {
            setWizardInitialState(undefined);
          }
        }}
        wizardInitialState={wizardInitialState}
        onScanFolder={(path) => {
          setWizardOpen(false);
          setBatchScanPath(path);
          setBatchScanOpen(true);
        }}
        editModalOpen={editModalOpen}
        onEditModalOpenChange={setEditModalOpen}
        selectedDataset={selectedDataset}
        onSaveDatasetConfig={datasetActions.saveDatasetConfig}
        onRefreshDatasetById={datasetActions.refreshDatasetById}
        groupsModalOpen={groupsModalOpen}
        onGroupsModalOpenChange={setGroupsModalOpen}
        groups={groups}
        datasets={datasets}
        onCreateDatasetGroup={datasetActions.createDatasetGroup}
        onRenameDatasetGroup={datasetActions.renameDatasetGroup}
        onDeleteDatasetGroup={datasetActions.deleteDatasetGroup}
        onAddDatasetToDatasetGroup={datasetActions.addDatasetToDatasetGroup}
        onRemoveDatasetFromDatasetGroup={datasetActions.removeDatasetFromDatasetGroup}
        syntheticDialogOpen={syntheticDialogOpen}
        onSyntheticDialogOpenChange={setSyntheticDialogOpen}
        onDatasetGenerated={() => { void datasetActions.refreshAll(); }}
        batchScanOpen={batchScanOpen}
        onBatchScanOpenChange={setBatchScanOpen}
        batchScanPath={batchScanPath}
        onBatchScanComplete={() => { void datasetActions.refreshAll(); }}
        isDragging={isDragging}
        dropType={dropType}
        itemCount={itemCount}
      />
    </motion.div>
  );
}
