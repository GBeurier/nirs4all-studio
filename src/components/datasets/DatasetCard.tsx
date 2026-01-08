import { Link } from "react-router-dom";
import { motion } from "framer-motion";
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
import type { Dataset, DatasetGroup, DatasetVersionStatus } from "@/types/datasets";

interface DatasetCardProps {
  dataset: Dataset;
  groups: DatasetGroup[];
  selected?: boolean;
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
function formatNumber(num: number | undefined): string {
  if (num === undefined) return "--";
  return num.toLocaleString();
}

export function DatasetCard({
  dataset,
  groups,
  selected,
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

  // Find assigned group
  const assignedGroup = groups.find((g) =>
    g.dataset_ids.includes(dataset.id)
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
          {/* Group badge */}
          {assignedGroup && (
            <Badge
              variant="default"
              className="bg-primary/20 text-primary hover:bg-primary/30 text-xs"
            >
              {assignedGroup.name}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground font-mono truncate">{dataset.path}</p>
      </div>

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
          <p className="text-muted-foreground text-xs">Targets</p>
          <p className="font-medium text-foreground truncate max-w-[80px]">
            {dataset.targets?.map(t => t.column).join(", ") || "--"}
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
                    window.open(`file://${dataset.path}`, "_blank");
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
                  className={!assignedGroup ? "bg-accent/50" : ""}
                >
                  {!assignedGroup && <Check className="h-4 w-4 mr-2" />}
                  {assignedGroup && <span className="w-6" />}
                  No Group
                </DropdownMenuItem>
                {groups.map((group) => (
                  <DropdownMenuItem
                    key={group.id}
                    onClick={() => onAssignGroup(dataset, group.id)}
                    className={assignedGroup?.id === group.id ? "bg-accent/50" : ""}
                  >
                    {assignedGroup?.id === group.id && <Check className="h-4 w-4 mr-2" />}
                    {assignedGroup?.id !== group.id && <span className="w-6" />}
                    {group.name}
                  </DropdownMenuItem>
                ))}
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
