import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowUpDown,
  BarChart3,
  Database,
  Filter,
  FlaskConical,
  FolderOpen,
  Grid3x3,
  HardDrive,
  Layers,
  Plus,
  RefreshCw,
  Search,
  Tags,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  BatchScanDialog,
  DatasetWizard,
  DropZoneOverlay,
  EditDatasetPanel,
  GroupsModal,
  SyntheticDataDialog,
} from "@/components/datasets";
import type { UpdateDatasetRequest } from "@/api/datasets";
import type { WizardInitialState } from "@/components/datasets/DatasetWizard";
import type {
  Dataset,
  DatasetConfig,
  DatasetGroup,
} from "@/types/datasets";
import type {
  DatasetFilterGroup,
  DatasetSortDirection,
  DatasetSortField,
} from "@/lib/datasetCatalog";

interface DatasetsHeaderProps {
  isDeveloperMode: boolean;
  onOpenGroups: () => void;
  onOpenSynthetic: () => void;
  onOpenWizard: () => void;
}

export function DatasetsHeader({
  isDeveloperMode,
  onOpenGroups,
  onOpenSynthetic,
  onOpenWizard,
}: DatasetsHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("datasets.title")}</h1>
        <p className="text-muted-foreground">
          {t("datasets.subtitle")}
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onOpenGroups}>
          <Tags className="mr-2 h-4 w-4" />
          {t("datasets.groups")}
        </Button>
        {isDeveloperMode && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  onClick={onOpenSynthetic}
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
        <Button onClick={onOpenWizard}>
          <Plus className="mr-2 h-4 w-4" />
          {t("datasets.addDataset")}
        </Button>
      </div>
    </div>
  );
}

interface DatasetsWorkspaceInfoProps {
  workspacePath: string | null;
  onSelectWorkspace: () => void;
}

export function DatasetsWorkspaceInfo({
  workspacePath,
  onSelectWorkspace,
}: DatasetsWorkspaceInfoProps) {
  const { t } = useTranslation();

  return (
    <Card className="glass-card border-primary/20">
      <CardContent className="py-1.5 px-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <HardDrive className="h-4.5 w-4.5 text-primary" />
            </div>
            <div className="flex-1 min-w-0 flex flex-col justify-center">
              <p className="text-xs font-medium text-muted-foreground leading-none">
                {t("datasets.workspace")}
              </p>
              <p className="text-sm font-medium truncate leading-none mt-1">
                {workspacePath || (
                  <span className="text-muted-foreground italic">
                    {t("datasets.noWorkspaceSelected")}
                  </span>
                )}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="h-8" onClick={onSelectWorkspace}>
            <FolderOpen className="mr-2 h-3.5 w-3.5" />
            {workspacePath ? t("datasets.change") : t("datasets.selectWorkspace")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface DatasetsStatsCardsProps {
  datasetCount: number;
  totalSamples: number;
  hasFeatureCounts: boolean;
  minFeatures: number;
  maxFeatures: number;
  groupCount: number;
}

export function DatasetsStatsCards({
  datasetCount,
  totalSamples,
  hasFeatureCounts,
  minFeatures,
  maxFeatures,
  groupCount,
}: DatasetsStatsCardsProps) {
  const { t } = useTranslation();
  const featureValue = hasFeatureCounts
    ? minFeatures === maxFeatures
      ? minFeatures.toLocaleString()
      : `${minFeatures}-${maxFeatures}`
    : "--";

  return (
    <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
      <DatasetsStatCard
        icon={Database}
        label={t("datasets.stats.totalDatasets")}
        value={datasetCount}
      />
      <DatasetsStatCard
        icon={BarChart3}
        label={t("datasets.stats.totalSamples")}
        value={totalSamples.toLocaleString()}
      />
      <DatasetsStatCard
        icon={Grid3x3}
        label={t("datasets.stats.features")}
        value={featureValue}
      />
      <DatasetsStatCard
        icon={Layers}
        label={t("datasets.stats.groups")}
        value={groupCount}
      />
    </div>
  );
}

interface DatasetsStatCardProps {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
}

function DatasetsStatCard({
  icon: Icon,
  label,
  value,
}: DatasetsStatCardProps) {
  return (
    <Card className="glass-card">
      <CardContent className="py-1.5 px-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="h-4.5 w-4.5 text-primary" />
          </div>
          <div className="flex flex-col justify-center">
            <p className="text-xs text-muted-foreground leading-none">
              {label}
            </p>
            <p className="text-xl font-bold leading-none">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface DatasetsToolbarProps {
  groups: DatasetGroup[];
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  filterGroup: DatasetFilterGroup;
  onFilterGroupChange: (group: DatasetFilterGroup) => void;
  sortField: DatasetSortField;
  onSortFieldChange: (field: DatasetSortField) => void;
  sortDirection: DatasetSortDirection;
  onSortDirectionChange: (direction: DatasetSortDirection) => void;
  refreshing: boolean;
  onRefreshAll: () => void;
}

export function DatasetsToolbar({
  groups,
  searchQuery,
  onSearchQueryChange,
  filterGroup,
  onFilterGroupChange,
  sortField,
  onSortFieldChange,
  sortDirection,
  onSortDirectionChange,
  refreshing,
  onRefreshAll,
}: DatasetsToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={t("datasets.filters.searchPlaceholder")}
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          className="pl-9"
        />
      </div>

      {groups.length > 0 && (
        <Select
          value={filterGroup}
          onValueChange={(value) => onFilterGroupChange(value as DatasetFilterGroup)}
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

      <Select
        value={sortField}
        onValueChange={(value) => onSortFieldChange(value as DatasetSortField)}
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

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onSortDirectionChange(sortDirection === "asc" ? "desc" : "asc")}
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
                onClick={onRefreshAll}
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
    </div>
  );
}

type AddDatasetHandler = (
  path: string,
  config?: Partial<DatasetConfig>,
) => Promise<void>;

interface DatasetsPageMountsProps {
  onAddDataset: AddDatasetHandler;
  wizardOpen: boolean;
  onWizardOpenChange: (open: boolean) => void;
  wizardInitialState: WizardInitialState | undefined;
  onScanFolder: (path: string) => void;
  editModalOpen: boolean;
  onEditModalOpenChange: (open: boolean) => void;
  selectedDataset: Dataset | null;
  onSaveDatasetConfig: (
    datasetId: string,
    updates: UpdateDatasetRequest,
  ) => Promise<void>;
  onRefreshDatasetById: (datasetId: string) => Promise<void>;
  groupsModalOpen: boolean;
  onGroupsModalOpenChange: (open: boolean) => void;
  groups: DatasetGroup[];
  datasets: Dataset[];
  onCreateDatasetGroup: (name: string) => Promise<void>;
  onRenameDatasetGroup: (groupId: string, newName: string) => Promise<void>;
  onDeleteDatasetGroup: (groupId: string) => Promise<void>;
  onAddDatasetToDatasetGroup: (groupId: string, datasetId: string) => Promise<void>;
  onRemoveDatasetFromDatasetGroup: (groupId: string, datasetId: string) => Promise<void>;
  syntheticDialogOpen: boolean;
  onSyntheticDialogOpenChange: (open: boolean) => void;
  onDatasetGenerated: () => void;
  batchScanOpen: boolean;
  onBatchScanOpenChange: (open: boolean) => void;
  batchScanPath: string;
  onBatchScanComplete: () => void;
  isDragging: boolean;
  dropType: "folder" | "files" | "unknown";
  itemCount: number;
}

export function DatasetsPageMounts({
  onAddDataset,
  wizardOpen,
  onWizardOpenChange,
  wizardInitialState,
  onScanFolder,
  editModalOpen,
  onEditModalOpenChange,
  selectedDataset,
  onSaveDatasetConfig,
  onRefreshDatasetById,
  groupsModalOpen,
  onGroupsModalOpenChange,
  groups,
  datasets,
  onCreateDatasetGroup,
  onRenameDatasetGroup,
  onDeleteDatasetGroup,
  onAddDatasetToDatasetGroup,
  onRemoveDatasetFromDatasetGroup,
  syntheticDialogOpen,
  onSyntheticDialogOpenChange,
  onDatasetGenerated,
  batchScanOpen,
  onBatchScanOpenChange,
  batchScanPath,
  onBatchScanComplete,
  isDragging,
  dropType,
  itemCount,
}: DatasetsPageMountsProps) {
  return (
    <>
      <DatasetWizard
        open={wizardOpen}
        onOpenChange={onWizardOpenChange}
        onAdd={onAddDataset}
        initialState={wizardInitialState}
        onScanFolder={onScanFolder}
      />

      <EditDatasetPanel
        open={editModalOpen}
        onOpenChange={onEditModalOpenChange}
        dataset={selectedDataset}
        onSave={onSaveDatasetConfig}
        onRefresh={onRefreshDatasetById}
      />

      <GroupsModal
        open={groupsModalOpen}
        onOpenChange={onGroupsModalOpenChange}
        groups={groups}
        datasets={datasets}
        onCreateGroup={onCreateDatasetGroup}
        onRenameGroup={onRenameDatasetGroup}
        onDeleteGroup={onDeleteDatasetGroup}
        onAddDatasetToGroup={onAddDatasetToDatasetGroup}
        onRemoveDatasetFromGroup={onRemoveDatasetFromDatasetGroup}
      />

      <SyntheticDataDialog
        open={syntheticDialogOpen}
        onOpenChange={onSyntheticDialogOpenChange}
        onDatasetGenerated={onDatasetGenerated}
      />

      <BatchScanDialog
        open={batchScanOpen}
        onOpenChange={onBatchScanOpenChange}
        folderPath={batchScanPath}
        onComplete={onBatchScanComplete}
      />

      <DropZoneOverlay
        isVisible={isDragging}
        dropType={dropType}
        itemCount={itemCount}
      />
    </>
  );
}
