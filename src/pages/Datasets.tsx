import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "@/lib/motion";
import {
  Database,
  Plus,
  Search,
  FolderOpen,
  RefreshCw,
  Filter,
  Tags,
  FlaskConical,
  ArrowUpDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DatasetCard,
  AddDatasetModal,
  EditDatasetPanel,
  GroupsModal,
  DatasetWizard,
  SyntheticDataDialog,
  DatasetQuickView,
  DropZoneOverlay,
  useDragDrop,
  type DroppedContent,
} from "@/components/datasets";
import type { WizardInitialState } from "@/components/datasets/DatasetWizard";
import { useIsDeveloperMode } from "@/context/DeveloperModeContext";
import {
  listDatasets,
  linkDataset,
  unlinkDataset,
  refreshDataset,
  updateDatasetConfig,
  type UpdateDatasetRequest,
  listGroups,
  createGroup,
  renameGroup,
  deleteGroup,
  addDatasetToGroup,
  removeDatasetFromGroup,
  getLinkedWorkspaces,
  reloadWorkspace,
  detectUnified,
} from "@/api/client";
import type { Dataset, DatasetGroup, DatasetConfig } from "@/types/datasets";

/** Get filename stem (without extension) */
function getStem(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv.gz') || lower.endsWith('.csv.zip')) {
    return filename.slice(0, -7);
  }
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.slice(0, idx) : filename;
}

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

type FilterGroup = "all" | string;

export default function Datasets() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Developer mode
  const isDeveloperMode = useIsDeveloperMode();

  // Data state
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [groups, setGroups] = useState<DatasetGroup[]>([]);
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // UI state
  const [searchQuery, setSearchQuery] = useState("");
  const [filterGroup, setFilterGroup] = useState<FilterGroup>("all");

  // Sort state
  type SortField = "name" | "linked_at" | "num_samples" | "group";
  const [sortField, setSortField] = useState<SortField>("linked_at");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  // Modal state
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [syntheticDialogOpen, setSyntheticDialogOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [groupsModalOpen, setGroupsModalOpen] = useState(false);
  const [selectedDataset, setSelectedDataset] = useState<Dataset | null>(null);

  // Quick view state - inline panel
  const [quickViewDataset, setQuickViewDataset] = useState<Dataset | null>(null);

  // Drag-and-drop state
  const [wizardInitialState, setWizardInitialState] = useState<WizardInitialState | undefined>(undefined);

  // Handle files/folders dropped from OS
  const handleDrop = useCallback(async (content: DroppedContent) => {
    // Start with basic initial state
    const initialState: WizardInitialState = {
      sourceType: content.type,
      basePath: content.path,
      skipToStep: "files", // Skip source selection, go directly to file mapping
    };

    // For folder drops with a valid path, use unified detection
    if (content.type === "folder" && content.path) {
      try {
        const result = await detectUnified({ path: content.path, recursive: true });
        // Enrich initial state with detection results
        initialState.files = result.files;
        initialState.detectedParsing = result.parsing_options;
        initialState.hasFoldFile = result.has_fold_file;
        initialState.foldFilePath = result.fold_file_path;
        initialState.metadataColumns = result.metadata_columns;
      } catch (e) {
        console.warn("Unified detection failed, wizard will handle manually:", e);
      }
    } else if (content.type === "folder" && content.folderName && content.items.length > 0) {
      // Web mode: folder dropped with file contents but no filesystem path
      // Use folder name and convert File objects to DetectedFile format
      initialState.basePath = content.folderName; // Use folder name as base path for dataset naming
      const detectedFiles = content.items.map((file) => {
        const filename = file.name;
        const lowerName = filename.toLowerCase();
        const stem = getStem(lowerName);

        let type: "X" | "Y" | "metadata" | "folds" | "unknown" = "unknown";
        let split: "train" | "test" | "unknown" = "unknown";

        // Match nirs4all FILE_PATTERNS - X patterns
        const xTrainPatterns = ["xcal", "x_cal", "cal_x", "calx", "train_x", "trainx", "x_train", "xtrain"];
        const xTestPatterns = ["xval", "x_val", "val_x", "valx", "xtest", "x_test", "test_x", "testx"];
        // Y patterns
        const yTrainPatterns = ["ycal", "y_cal", "cal_y", "caly", "train_y", "trainy", "y_train", "ytrain"];
        const yTestPatterns = ["ytest", "y_test", "test_y", "testy", "yval", "y_val", "val_y", "valy"];
        // Metadata patterns
        const metaTrainPatterns = ["mcal", "m_cal", "cal_m", "calm", "train_m", "trainm", "m_train", "mtrain",
          "metacal", "meta_cal", "cal_meta", "calmeta", "train_meta", "trainmeta", "meta_train", "metatrain",
          "metadatacal", "metadata_cal", "cal_metadata", "calmetadata", "train_metadata", "trainmetadata", "metadata_train", "metadatatrain"];
        const metaTestPatterns = ["mtest", "m_test", "test_m", "testm", "mval", "m_val", "val_m", "valm",
          "metatest", "meta_test", "test_meta", "testmeta", "metaval", "meta_val", "val_meta", "valmeta",
          "metadatatest", "metadata_test", "test_metadata", "testmetadata", "metadataval", "metadata_val", "val_metadata", "valmetadata"];
        // Fold patterns
        const foldPatterns = ["folds", "fold", "cv_folds", "cvfolds", "cross_validation", "crossvalidation", "cv", "splits"];

        // Check patterns (using substring match like nirs4all)
        if (xTrainPatterns.some(p => lowerName.includes(p))) {
          type = "X"; split = "train";
        } else if (xTestPatterns.some(p => lowerName.includes(p))) {
          type = "X"; split = "test";
        } else if (yTrainPatterns.some(p => lowerName.includes(p))) {
          type = "Y"; split = "train";
        } else if (yTestPatterns.some(p => lowerName.includes(p))) {
          type = "Y"; split = "test";
        } else if (metaTrainPatterns.some(p => lowerName.includes(p))) {
          type = "metadata"; split = "train";
        } else if (metaTestPatterns.some(p => lowerName.includes(p))) {
          type = "metadata"; split = "test";
        } else if (foldPatterns.some(p => lowerName.includes(p))) {
          type = "folds"; split = "train";
        } else if (stem === "x") {
          type = "X"; split = "train";
        } else if (stem === "y") {
          type = "Y"; split = "train";
        } else if (["m", "meta", "metadata", "group"].includes(stem)) {
          type = "metadata"; split = "train";
        }

        let format: "csv" | "xlsx" | "xls" | "mat" | "npy" | "npz" | "parquet" = "csv";
        if (lowerName.endsWith(".xlsx")) format = "xlsx";
        else if (lowerName.endsWith(".xls")) format = "xls";
        else if (lowerName.endsWith(".parquet")) format = "parquet";
        else if (lowerName.endsWith(".npy")) format = "npy";
        else if (lowerName.endsWith(".npz")) format = "npz";
        else if (lowerName.endsWith(".mat")) format = "mat";

        return {
          path: content.relativePaths?.find(p => p.endsWith(filename)) || filename,
          filename,
          type: type === "folds" ? "unknown" : type, // folds handled separately
          split: split === "unknown" ? "train" : split,
          source: type === "X" ? 1 : null,
          format,
          size_bytes: file.size,
          confidence: type !== "unknown" ? 0.9 : 0.3,
          detected: true,
        };
      });

      initialState.files = detectedFiles;

      // Store File objects for web mode (needed for reading file content)
      const fileBlobs = new Map<string, File>();
      content.items.forEach((file) => {
        const path = content.relativePaths?.find(p => p.endsWith(file.name)) || file.name;
        fileBlobs.set(path, file);
      });
      initialState.fileBlobs = fileBlobs;
    }

    setWizardInitialState(initialState);
    setWizardOpen(true);
  }, []);

  // Drag-and-drop hook
  const { isDragging, dropType, itemCount } = useDragDrop({
    onDrop: handleDrop,
    disabled: false,
  });

  // Load data
  const loadData = useCallback(async () => {
    try {
      setLoading(true);

      // Reload workspace from disk to ensure fresh data
      await reloadWorkspace();

      // Load workspace path from linked workspaces (active workspace)
      try {
        const linkedRes = await getLinkedWorkspaces();
        const active = linkedRes.workspaces.find((ws) => ws.is_active);
        setWorkspacePath(active?.path ?? null);
      } catch {
        setWorkspacePath(null);
      }

      // Load datasets
      const dsResponse = await listDatasets();
      setDatasets(dsResponse.datasets || []);

      // Load groups
      const groupsResponse = await listGroups();
      setGroups(groupsResponse.groups || []);
    } catch (error) {
      console.error("Failed to load data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);


  // Normalize datasets to ensure they have required fields
  const normalizedDatasets = datasets.map((ds, index) => {
    if (!ds) return null;
    return {
      ...ds,
      id: ds.id || ds.path || `temp-${index}`,
      name: ds.name || ds.path?.split("/").pop() || `Dataset ${index + 1}`,
      path: ds.path || "",
    };
  }).filter((ds): ds is Dataset => ds !== null);

  // Helper to get assigned group for a dataset
  const getAssignedGroup = (datasetId: string) =>
    groups.find((g) => g.dataset_ids?.includes(datasetId));

  // Filter datasets
  const filteredDatasets = normalizedDatasets
    .filter((ds) => {
      // Search filter (with null safety) - includes group name
      const assignedGroup = getAssignedGroup(ds.id);
      const matchesSearch =
        !searchQuery ||
        ds.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ds.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (assignedGroup?.name.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);

      // Group filter
      let matchesGroup = true;
      if (filterGroup !== "all") {
        const group = groups.find((g) => g.id === filterGroup);
        matchesGroup = group?.dataset_ids?.includes(ds.id) || false;
      }

      return matchesSearch && matchesGroup;
    })
    .sort((a, b) => {
      // Sort datasets
      let comparison = 0;

      switch (sortField) {
        case "name":
          comparison = a.name.localeCompare(b.name);
          break;
        case "linked_at":
          comparison = new Date(a.linked_at).getTime() - new Date(b.linked_at).getTime();
          break;
        case "num_samples":
          comparison = (a.num_samples || 0) - (b.num_samples || 0);
          break;
        case "group": {
          // Sort by group name, ungrouped last
          const groupA = getAssignedGroup(a.id)?.name || "\uffff"; // Unicode max to sort ungrouped last
          const groupB = getAssignedGroup(b.id)?.name || "\uffff";
          comparison = groupA.localeCompare(groupB);
          break;
        }
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });


  // Stats
  const totalSamples = normalizedDatasets.reduce(
    (sum, ds) => sum + (ds.num_samples || 0),
    0
  );
  const totalFeatures = normalizedDatasets.reduce(
    (sum, ds) => sum + (ds.num_features || 0),
    0
  );

  // Handlers
  const handleSelectWorkspace = () => {
    navigate("/settings?tab=workspaces");
  };

  const handleRefreshAll = async () => {
    setRefreshing(true);
    try {
      await loadData();
    } finally {
      setRefreshing(false);
    }
  };

  const handleAddDataset = async (
    path: string,
    config?: Partial<DatasetConfig>
  ) => {
    const result = await linkDataset(path, config);
    if (!result.success) {
      throw new Error("Failed to link dataset");
    }
    await loadData();
  };

  const handleEditDataset = (dataset: Dataset) => {
    setSelectedDataset(dataset);
    setEditModalOpen(true);
  };

  const handleSaveDatasetConfig = async (
    datasetId: string,
    updates: UpdateDatasetRequest
  ) => {
    await updateDatasetConfig(datasetId, updates);
    await loadData();
  };

  const handleDeleteDataset = async (dataset: Dataset) => {
    if (!confirm(`Remove "${dataset.name}" from workspace?`)) return;
    await unlinkDataset(dataset.id);
    // Clear quick view if deleted dataset was selected
    if (quickViewDataset?.id === dataset.id) {
      setQuickViewDataset(null);
    }
    await loadData();
  };

  const handleRefreshDataset = async (dataset: Dataset) => {
    await refreshDataset(dataset.id);
    await loadData();
  };

  const handleAssignGroup = async (
    dataset: Dataset,
    groupId: string | null
  ) => {
    // Remove from current group
    const currentGroup = groups.find((g) => g.dataset_ids?.includes(dataset.id));
    if (currentGroup) {
      await removeDatasetFromGroup(currentGroup.id, dataset.id);
    }

    // Add to new group
    if (groupId) {
      await addDatasetToGroup(groupId, dataset.id);
    }

    await loadData();
  };

  // Groups handlers
  const handleCreateGroup = async (name: string) => {
    await createGroup(name);
    await loadData();
  };

  const handleRenameGroup = async (groupId: string, newName: string) => {
    await renameGroup(groupId, newName);
    await loadData();
  };

  const handleDeleteGroup = async (groupId: string) => {
    await deleteGroup(groupId);
    await loadData();
  };

  const handleRemoveDatasetFromGroup = async (
    groupId: string,
    datasetId: string
  ) => {
    await removeDatasetFromGroup(groupId, datasetId);
    await loadData();
  };

  return (
    <motion.div
      className="space-y-6"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Header */}
      <motion.div
        variants={itemVariants}
        className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("datasets.title")}</h1>
          <p className="text-muted-foreground">
            {t("datasets.subtitle")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setGroupsModalOpen(true)}>
            <Tags className="mr-2 h-4 w-4" />
            {t("datasets.groups")}
          </Button>
          {isDeveloperMode && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    onClick={() => setSyntheticDialogOpen(true)}
                    className="border-primary/30 hover:border-primary/50"
                  >
                    <FlaskConical className="mr-2 h-4 w-4" />
                    {t("datasets.generateSynthetic")}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t("datasets.generateSyntheticHint")}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <Button onClick={() => setWizardOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {t("datasets.addDataset")}
          </Button>
        </div>
      </motion.div>

      {/* Stats */}
      <motion.div variants={itemVariants} className="grid gap-4 md:grid-cols-4">
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("datasets.stats.totalDatasets")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{normalizedDatasets.length}</div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("datasets.stats.totalSamples")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {totalSamples.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("datasets.stats.avgFeatures")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {normalizedDatasets.length > 0
                ? Math.round(totalFeatures / normalizedDatasets.length).toLocaleString()
                : 0}
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("datasets.stats.groups")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{groups.length}</div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Search and Filter */}
      <motion.div
        variants={itemVariants}
        className="flex flex-wrap items-center gap-4"
      >
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("datasets.filters.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {groups.length > 0 && (
          <Select
            value={filterGroup}
            onValueChange={(v) => setFilterGroup(v as FilterGroup)}
          >
            <SelectTrigger className="w-[180px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder={t("datasets.filters.groupPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("datasets.filters.allDatasets")}</SelectItem>
              {groups.map((group) => (
                <SelectItem key={group.id} value={group.id}>
                  {group.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Sort dropdown */}
        <Select
          value={sortField}
          onValueChange={(v) => setSortField(v as SortField)}
        >
          <SelectTrigger className="w-[150px]">
            <ArrowUpDown className="h-4 w-4 mr-2" />
            <SelectValue placeholder={t("datasets.filters.sortPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">{t("datasets.sort.name")}</SelectItem>
            <SelectItem value="linked_at">{t("datasets.sort.dateAdded")}</SelectItem>
            <SelectItem value="num_samples">{t("datasets.sort.samples")}</SelectItem>
            <SelectItem value="group">{t("datasets.sort.group")}</SelectItem>
          </SelectContent>
        </Select>

        {/* Sort direction toggle */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSortDirection((d) => (d === "asc" ? "desc" : "asc"))}
              >
                {sortDirection === "asc" ? (
                  <ArrowUpDown className="h-4 w-4 rotate-180" />
                ) : (
                  <ArrowUpDown className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {sortDirection === "asc" ? t("datasets.sort.ascending") : t("datasets.sort.descending")}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <div className="ml-auto">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleRefreshAll}
                  disabled={refreshing}
                >
                  <RefreshCw
                    className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("datasets.refreshAll")}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
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
          <div className="flex gap-6">
            {/* Dataset List */}
            <div className="flex-1 space-y-3 min-w-0">
              {filteredDatasets.map((dataset) => (
                <DatasetCard
                  key={dataset.id}
                  dataset={dataset}
                  groups={groups}
                  selected={quickViewDataset?.id === dataset.id}
                  onSelect={(ds) => setQuickViewDataset(ds)}
                  onPreview={(ds) => setQuickViewDataset(ds)}
                  onEdit={() => handleEditDataset(dataset)}
                  onDelete={() => handleDeleteDataset(dataset)}
                  onRefresh={() => handleRefreshDataset(dataset)}
                  onAssignGroup={(ds, groupId) => handleAssignGroup(ds, groupId)}
                />
              ))}
            </div>

            {/* Quick View Panel (inline) */}
            {quickViewDataset && (
              <DatasetQuickView
                dataset={quickViewDataset}
                onClose={() => setQuickViewDataset(null)}
                onEdit={(ds) => {
                  setSelectedDataset(ds);
                  setEditModalOpen(true);
                }}
              />
            )}
          </div>
        )}
      </motion.div>

      {/* Workspace Info */}
      <motion.div variants={itemVariants}>
        <Card className="border-dashed">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Badge variant="outline">Workspace</Badge>
              <span className="text-sm text-muted-foreground truncate max-w-md">
                {workspacePath || t("datasets.noWorkspaceSelected")}
              </span>
            </div>
            <Button variant="ghost" size="sm" onClick={handleSelectWorkspace}>
              {workspacePath ? t("datasets.change") : t("datasets.selectWorkspace")}
            </Button>
          </CardContent>
        </Card>
      </motion.div>

      {/* Modals */}
      <AddDatasetModal
        open={addModalOpen}
        onOpenChange={setAddModalOpen}
        onAdd={handleAddDataset}
      />

      {/* New Dataset Wizard */}
      <DatasetWizard
        open={wizardOpen}
        onOpenChange={(open) => {
          setWizardOpen(open);
          // Clear initial state when wizard closes
          if (!open) {
            setWizardInitialState(undefined);
          }
        }}
        onAdd={handleAddDataset}
        initialState={wizardInitialState}
      />

      <EditDatasetPanel
        open={editModalOpen}
        onOpenChange={setEditModalOpen}
        dataset={selectedDataset}
        onSave={handleSaveDatasetConfig}
        onRefresh={async (datasetId) => {
          await refreshDataset(datasetId);
          await loadData();
        }}
      />

      <GroupsModal
        open={groupsModalOpen}
        onOpenChange={setGroupsModalOpen}
        groups={groups}
        datasets={datasets}
        onCreateGroup={handleCreateGroup}
        onRenameGroup={handleRenameGroup}
        onDeleteGroup={handleDeleteGroup}
        onAddDatasetToGroup={async (groupId, datasetId) => {
          await addDatasetToGroup(groupId, datasetId);
          await loadData();
        }}
        onRemoveDatasetFromGroup={handleRemoveDatasetFromGroup}
      />

      {/* Synthetic Data Dialog (Developer Mode) */}
      <SyntheticDataDialog
        open={syntheticDialogOpen}
        onOpenChange={setSyntheticDialogOpen}
        onDatasetGenerated={() => loadData()}
      />

      {/* Drag & Drop Overlay */}
      <DropZoneOverlay
        isVisible={isDragging}
        dropType={dropType}
        itemCount={itemCount}
      />
    </motion.div>
  );
}
