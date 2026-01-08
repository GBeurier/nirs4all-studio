import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
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
} from "@/components/datasets";
import { useIsDeveloperMode } from "@/context/DeveloperModeContext";
import {
  listDatasets,
  linkDataset,
  unlinkDataset,
  refreshDataset,
  updateDatasetConfig,
  listGroups,
  createGroup,
  renameGroup,
  deleteGroup,
  addDatasetToGroup,
  removeDatasetFromGroup,
  getWorkspace,
  selectWorkspace,
  reloadWorkspace,
} from "@/api/client";
import { selectFolder } from "@/utils/fileDialogs";
import type { Dataset, DatasetGroup, DatasetConfig } from "@/types/datasets";

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

  // Load data
  const loadData = useCallback(async () => {
    try {
      setLoading(true);

      // Reload workspace from disk to ensure fresh data
      await reloadWorkspace();

      // Load workspace
      const wsResponse = await getWorkspace();
      if (wsResponse.workspace) {
        setWorkspacePath(wsResponse.workspace.path);
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

  // Debug: Log datasets when they change
  useEffect(() => {
    if (datasets.length > 0) {
      console.log("Datasets loaded:", JSON.stringify(datasets, null, 2));
      console.log("Filter state - searchQuery:", JSON.stringify(searchQuery), "filterGroup:", JSON.stringify(filterGroup));
    }
  }, [datasets, searchQuery, filterGroup]);

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
    groups.find((g) => g.dataset_ids.includes(datasetId));

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
        matchesGroup = group?.dataset_ids.includes(ds.id) || false;
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

  // Debug: Log filtered results
  useEffect(() => {
    console.log(`Filtered: ${filteredDatasets.length} of ${normalizedDatasets.length} datasets (raw: ${datasets.length})`);
    if (normalizedDatasets.length > 0 && filteredDatasets.length === 0) {
      console.warn("All datasets were filtered out! Check filter criteria.");
    }
  }, [filteredDatasets, normalizedDatasets, datasets]);

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
  const handleSelectWorkspace = async () => {
    try {
      const path = await selectFolder();
      if (path) {
        await selectWorkspace(path, true);
        await loadData();
      }
    } catch (error) {
      console.error("Failed to select workspace:", error);
    }
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
    await linkDataset(path, config);
    await loadData();
  };

  const handleEditDataset = (dataset: Dataset) => {
    setSelectedDataset(dataset);
    setEditModalOpen(true);
  };

  const handleSaveDatasetConfig = async (
    datasetId: string,
    config: Partial<DatasetConfig>
  ) => {
    await updateDatasetConfig(datasetId, config);
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
    const currentGroup = groups.find((g) => g.dataset_ids.includes(dataset.id));
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
          <h1 className="text-2xl font-bold tracking-tight">Datasets</h1>
          <p className="text-muted-foreground">
            Manage your spectral datasets and configurations
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setGroupsModalOpen(true)}>
            <Tags className="mr-2 h-4 w-4" />
            Groups
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
                    Generate
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Generate synthetic dataset (Dev Mode)</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <Button onClick={() => setWizardOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Dataset
          </Button>
        </div>
      </motion.div>

      {/* Stats */}
      <motion.div variants={itemVariants} className="grid gap-4 md:grid-cols-4">
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Datasets
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{normalizedDatasets.length}</div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Samples
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
              Avg Features
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
              Groups
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
            placeholder="Search datasets..."
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
              <SelectValue placeholder="Filter by group" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Datasets</SelectItem>
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
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="linked_at">Date Added</SelectItem>
            <SelectItem value="num_samples">Samples</SelectItem>
            <SelectItem value="group">Group</SelectItem>
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
              {sortDirection === "asc" ? "Ascending" : "Descending"}
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
              <TooltipContent>Refresh All</TooltipContent>
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
                <p className="text-muted-foreground">Loading datasets...</p>
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
                  {normalizedDatasets.length === 0 ? "No datasets yet" : "No matches"}
                </h3>
                <p className="text-muted-foreground max-w-md mb-6">
                  {normalizedDatasets.length === 0
                    ? "Get started by adding a dataset. You can link a folder containing your spectral data files."
                    : "Try adjusting your search or filter criteria."}
                </p>
                {normalizedDatasets.length === 0 && (
                  <div className="flex gap-3">
                    <Button variant="outline" onClick={handleSelectWorkspace}>
                      <FolderOpen className="mr-2 h-4 w-4" />
                      Select Workspace
                    </Button>
                    <Button onClick={() => setWizardOpen(true)}>
                      <Plus className="mr-2 h-4 w-4" />
                      Add Dataset
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
                {workspacePath || "No workspace selected"}
              </span>
            </div>
            <Button variant="ghost" size="sm" onClick={handleSelectWorkspace}>
              {workspacePath ? "Change" : "Select Workspace"}
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
        onOpenChange={setWizardOpen}
        onAdd={handleAddDataset}
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
    </motion.div>
  );
}
