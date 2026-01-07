import { motion } from "framer-motion";
import {
  FileSpreadsheet,
  MoreVertical,
  Eye,
  Trash2,
  Download,
  Settings,
  FolderOpen,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  XCircle,
  Link2,
  ShieldCheck,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
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
  onPreview?: (dataset: Dataset) => void;
  onEdit?: (dataset: Dataset) => void;
  onDelete?: (dataset: Dataset) => void;
  onExport?: (dataset: Dataset) => void;
  onRefresh?: (dataset: Dataset) => void;
  onVerify?: (dataset: Dataset) => void;
  onRelink?: (dataset: Dataset) => void;
  onAssignGroup?: (dataset: Dataset, groupId: string | null) => void;
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

/**
 * Get relative time string from ISO date
 */
function getRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

/**
 * Format number with commas
 */
function formatNumber(num: number | undefined): string {
  if (num === undefined) return "--";
  return num.toLocaleString();
}

/**
 * Get status icon and color
 */
function getStatusIndicator(status?: string) {
  switch (status) {
    case "available":
      return { icon: CheckCircle, color: "text-success", label: "Available" };
    case "missing":
      return { icon: XCircle, color: "text-destructive", label: "Missing" };
    case "loading":
      return { icon: RefreshCw, color: "text-primary animate-spin", label: "Loading" };
    case "error":
      return { icon: AlertCircle, color: "text-warning", label: "Error" };
    default:
      return { icon: CheckCircle, color: "text-muted-foreground", label: "Unknown" };
  }
}

export function DatasetCard({
  dataset,
  groups,
  onPreview,
  onEdit,
  onDelete,
  onExport,
  onRefresh,
  onVerify,
  onRelink,
  onAssignGroup,
}: DatasetCardProps) {
  const status = getStatusIndicator(dataset.status);
  const StatusIcon = status.icon;
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
    <motion.div variants={itemVariants}>
      <Card className="hover:shadow-md transition-shadow duration-200 hover:border-primary/30">
        <CardContent className="p-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="p-2 rounded-lg bg-primary/10 flex-shrink-0">
                <FileSpreadsheet className="h-6 w-6 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-foreground truncate">
                    {dataset.name}
                  </h3>
                  {/* Version status badge (Phase 2) */}
                  <DatasetStatusBadge
                    status={versionStatus}
                    lastVerified={dataset.last_verified}
                    hash={dataset.hash}
                  />
                </div>
                <p className="text-sm text-muted-foreground truncate" title={dataset.path}>
                  {getRelativeTime(dataset.linked_at)}
                </p>
              </div>
            </div>

            {/* Actions dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="flex-shrink-0">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onPreview && (
                  <DropdownMenuItem onClick={() => onPreview(dataset)}>
                    <Eye className="h-4 w-4 mr-2" />
                    Preview
                  </DropdownMenuItem>
                )}
                {onEdit && (
                  <DropdownMenuItem onClick={() => onEdit(dataset)}>
                    <Settings className="h-4 w-4 mr-2" />
                    Edit Config
                  </DropdownMenuItem>
                )}

                {/* Version management actions (Phase 2) */}
                <DropdownMenuSeparator />
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
                <DropdownMenuSeparator />

                {onExport && (
                  <DropdownMenuItem onClick={() => onExport(dataset)}>
                    <Download className="h-4 w-4 mr-2" />
                    Export
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => {
                    if (dataset.path) {
                      // Open folder in file explorer (handled by backend)
                      window.open(`file://${dataset.path}`, "_blank");
                    }
                  }}
                >
                  <FolderOpen className="h-4 w-4 mr-2" />
                  Open Folder
                </DropdownMenuItem>

                {/* Groups submenu */}
                {groups.length > 0 && onAssignGroup && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => onAssignGroup(dataset, null)}
                      className={!assignedGroup ? "text-muted-foreground" : ""}
                    >
                      No Group
                    </DropdownMenuItem>
                    {groups.map((group) => (
                      <DropdownMenuItem
                        key={group.id}
                        onClick={() => onAssignGroup(dataset, group.id)}
                        className={assignedGroup?.id === group.id ? "bg-accent" : ""}
                      >
                        {group.name}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}

                {onDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => onDelete(dataset)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Stats grid */}
          <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Samples</p>
              <p className="font-medium text-foreground">
                {formatNumber(dataset.num_samples)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Features</p>
              <p className="font-medium text-foreground">
                {formatNumber(dataset.num_features)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Sources</p>
              <p className="font-medium text-foreground">
                {dataset.n_sources ?? "--"}
              </p>
            </div>
          </div>

          {/* Tags */}
          <div className="mt-4 flex flex-wrap gap-2">
            {/* Task type */}
            {dataset.task_type && (
              <Badge variant="secondary" className="capitalize">
                {dataset.task_type}
              </Badge>
            )}

            {/* Classification classes */}
            {dataset.task_type === "classification" && dataset.num_classes && (
              <Badge variant="outline">{dataset.num_classes} classes</Badge>
            )}

            {/* Multi-target indicator (Phase 3) */}
            {dataset.targets && dataset.targets.length > 1 && (
              <Badge variant="outline" className="bg-primary/5">
                {dataset.targets.length} targets
              </Badge>
            )}

            {/* Default target (Phase 3) */}
            {dataset.default_target && (
              <Badge variant="outline" className="text-xs">
                Target: {dataset.default_target}
                {dataset.targets?.find((t) => t.column === dataset.default_target)?.unit && (
                  <span className="ml-1 opacity-70">
                    ({dataset.targets.find((t) => t.column === dataset.default_target)?.unit})
                  </span>
                )}
              </Badge>
            )}

            {/* Multi-source indicator */}
            {dataset.is_multi_source && (
              <Badge variant="outline">Multi-source</Badge>
            )}

            {/* Signal types */}
            {dataset.signal_types?.map((type) => (
              <Badge key={type} variant="outline" className="text-xs">
                {type}
              </Badge>
            ))}

            {/* Group badge */}
            {assignedGroup && (
              <Badge
                variant="default"
                className="bg-primary/20 text-primary hover:bg-primary/30"
              >
                {assignedGroup.name}
              </Badge>
            )}
          </div>

          {/* Warning/Error message */}
          {dataset.load_warning && (
            <div className="mt-3 p-2 rounded bg-warning/10 border border-warning/20">
              <p className="text-xs text-warning flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {dataset.load_warning}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
