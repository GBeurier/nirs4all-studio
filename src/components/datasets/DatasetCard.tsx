import { Link } from "react-router-dom";
import { motion } from "@/lib/motion";
import {
  FileSpreadsheet,
  MoreVertical,
  Eye,
  ExternalLink,
  Trash2,
  Download,
  Settings,
  FolderOpen,
  RefreshCw,
  AlertCircle,
  Link2,
  ShieldCheck,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DatasetStatusBadge } from "./DatasetStatusBadge";
import { openFolderInExplorer } from "@/api/client";
import { formatScore } from "@/lib/scores";
import type { Dataset, DatasetGroup, DatasetVersionStatus } from "@/types/datasets";

export interface DatasetScoreInfo {
  score: number;
  metric: string;
  model?: string;
  isFinal: boolean;
  cvScore?: number | null;
}

interface DatasetCardProps {
  dataset: Dataset;
  groups: DatasetGroup[];
  selected?: boolean;
  bestScore?: DatasetScoreInfo | null;
  onSelect?: (dataset: Dataset) => void;
  onPreview?: (dataset: Dataset) => void;
  onEdit?: (dataset: Dataset) => void;
  onDelete?: (dataset: Dataset) => void;
  onExport?: (dataset: Dataset) => void;
  onRefresh?: (dataset: Dataset) => void;
  onVerify?: (dataset: Dataset) => void;
  onRelink?: (dataset: Dataset) => void;
  onAssignGroup?: (dataset: Dataset, groupId: string | null) => void;
}

/**
 * Format number with commas
 */
function formatNumber(num: number | undefined | null): string {
  if (num == null) return "--";
  return num.toLocaleString();
}

export function DatasetCard({
  dataset,
  groups,
  selected,
  bestScore,
  onSelect,
  onPreview,
  onEdit,
  onDelete,
  onExport,
  onRefresh,
  onVerify,
  onRelink,
  onAssignGroup,
}: DatasetCardProps) {
  const versionStatus = (dataset.version_status || "unchecked") as DatasetVersionStatus;

  // Find assigned groups (multi-group support)
  const assignedGroups = groups.filter((g) =>
    g.dataset_ids?.includes(dataset.id)
  );

  // Determine if versioning actions should be shown
  const showVerifyAction = versionStatus === "unchecked" || versionStatus === "current";
  const showRefreshAction = versionStatus === "modified";
  const showRelinkAction = versionStatus === "missing" || dataset.status === "missing";

  return (
    <motion.div
      className={`
        flex items-center gap-4 p-4 rounded-lg border bg-card cursor-pointer transition-colors
        ${selected ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/30"}
      `}
      onClick={() => onSelect?.(dataset)}
    >
      {/* Icon */}
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 flex-shrink-0">
        <FileSpreadsheet className="h-6 w-6 text-primary" />
      </div>

      {/* Main Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-foreground truncate">{dataset.name}</h3>
          <DatasetStatusBadge
            status={versionStatus}
            lastVerified={dataset.last_verified}
            hash={dataset.hash}
          />
          {/* Group badges */}
          {assignedGroups.map((g) => (
            <Badge
              key={g.id}
              variant="default"
              className="bg-primary/20 text-primary hover:bg-primary/30 text-xs"
            >
              {g.name}
            </Badge>
          ))}
        </div>
        <p className="text-sm text-muted-foreground font-mono truncate">{dataset.path}</p>
      </div>

      {/* Best Score Display */}
      {bestScore && (
        <div className="hidden lg:flex flex-col items-end gap-0.5 flex-shrink-0 min-w-[140px]">
          <div className="flex items-baseline gap-1.5">
            <span className={`text-lg font-bold font-mono tabular-nums ${
              bestScore.isFinal ? "text-emerald-500" : "text-chart-1"
            }`}>
              {formatScore(bestScore.score)}
            </span>
            <span className="text-[10px] font-medium text-muted-foreground uppercase">
              {bestScore.metric}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className={`font-medium uppercase ${
              bestScore.isFinal ? "text-emerald-500/70" : "text-chart-1/70"
            }`}>
              {bestScore.isFinal ? "Final" : "CV"}
            </span>
            {bestScore.model && (
              <>
                <span className="text-muted-foreground/40">&middot;</span>
                <span className="font-mono truncate max-w-[90px]" title={bestScore.model}>{bestScore.model}</span>
              </>
            )}
            {bestScore.isFinal && bestScore.cvScore != null && (
              <>
                <span className="text-muted-foreground/40">&middot;</span>
                <span className="font-mono">CV {formatScore(bestScore.cvScore)}</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Stats - visible on larger screens */}
      <div className="hidden md:flex items-center gap-8 text-sm flex-shrink-0">
        <div className="text-center min-w-[70px]">
          <p className="text-muted-foreground text-xs">Samples</p>
          <p className="font-medium text-foreground">{formatNumber(dataset.num_samples)}</p>
        </div>
        <div className="text-center min-w-[70px]">
          <p className="text-muted-foreground text-xs">Features</p>
          <p className="font-medium text-foreground">{formatNumber(dataset.num_features)}</p>
        </div>
        <div className="text-center min-w-[80px]">
          <p className="text-muted-foreground text-xs">Task</p>
          <p className="font-medium text-foreground truncate max-w-[80px]">
            {dataset.task_type === "regression"
              ? "Reg"
              : dataset.task_type === "classification"
                ? (dataset.num_classes && dataset.num_classes > 2 ? "Multi" : "Classif")
                : "--"}
          </p>
        </div>
      </div>

      {/* Direct Action Buttons */}
      <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
        {/* Quick View */}
        {onPreview && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onPreview(dataset)}
                >
                  <Eye className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Quick View</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Full Details */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                asChild
              >
                <Link to={`/datasets/${dataset.id}`}>
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Full Details</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Edit */}
        {onEdit && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onEdit(dataset)}
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Edit Config</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Open Folder */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  if (dataset.path) {
                    openFolderInExplorer(dataset.path);
                  }
                }}
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Open Folder</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Delete */}
        {onDelete && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => onDelete(dataset)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Remove Dataset</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* More Actions Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {/* Version management actions */}
            {showVerifyAction && onVerify && (
              <DropdownMenuItem onClick={() => onVerify(dataset)}>
                <ShieldCheck className="h-4 w-4 mr-2" />
                Verify Integrity
              </DropdownMenuItem>
            )}
            {showRefreshAction && onRefresh && (
              <DropdownMenuItem onClick={() => onRefresh(dataset)}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Accept Changes
              </DropdownMenuItem>
            )}
            {showRelinkAction && onRelink && (
              <DropdownMenuItem onClick={() => onRelink(dataset)}>
                <Link2 className="h-4 w-4 mr-2" />
                Relink Path
              </DropdownMenuItem>
            )}

            {onExport && (
              <>
                {(showVerifyAction || showRefreshAction || showRelinkAction) && <DropdownMenuSeparator />}
                <DropdownMenuItem onClick={() => onExport(dataset)}>
                  <Download className="h-4 w-4 mr-2" />
                  Export
                </DropdownMenuItem>
              </>
            )}

            {/* Groups assignment */}
            {onAssignGroup && (
              <>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  Assign to Group
                </div>
                <DropdownMenuItem
                  onClick={() => onAssignGroup(dataset, null)}
                  className={assignedGroups.length === 0 ? "bg-accent/50" : ""}
                >
                  {assignedGroups.length === 0 && <Check className="h-4 w-4 mr-2" />}
                  {assignedGroups.length > 0 && <span className="w-6" />}
                  No Group
                </DropdownMenuItem>
                {groups.map((group) => {
                  const isAssigned = assignedGroups.some(g => g.id === group.id);
                  return (
                    <DropdownMenuItem
                      key={group.id}
                      onClick={() => onAssignGroup(dataset, group.id)}
                      className={isAssigned ? "bg-accent/50" : ""}
                    >
                      {isAssigned && <Check className="h-4 w-4 mr-2" />}
                      {!isAssigned && <span className="w-6" />}
                      {group.name}
                    </DropdownMenuItem>
                  );
                })}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Warning/Error indicator */}
      {dataset.load_warning && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertCircle className="h-4 w-4 text-warning flex-shrink-0" />
            </TooltipTrigger>
            <TooltipContent>{dataset.load_warning}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </motion.div>
  );
}
