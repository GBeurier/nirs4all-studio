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
import { getConfiguredRepetitionColumn } from "@/lib/datasetConfig";
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
import { getDatasetTaskLabel } from "@/lib/datasetTask";
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
 * Format number with commas. Arrays (multi-source counts) are summed.
 */
function formatNumber(num: number | number[] | undefined | null): string {
  if (num == null) return "--";
  if (Array.isArray(num)) {
    const total = num.reduce((acc, v) => acc + (typeof v === "number" ? v : 0), 0);
    return total.toLocaleString();
  }
  return num.toLocaleString();
}

/**
 * Build a compact per-source breakdown string (e.g. "450+650+200").
 * Returns null when the input is not a multi-value array.
 */
function formatPerSource(num: number | number[] | undefined | null): string | null {
  if (!Array.isArray(num) || num.length < 2) return null;
  return num.map((v) => (typeof v === "number" ? v.toLocaleString() : "?")).join("+");
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
  const repetitionColumn = getConfiguredRepetitionColumn(dataset.config);

  // Find assigned groups (multi-group support)
  const assignedGroups = groups.filter((g) =>
    g.dataset_ids?.includes(dataset.id)
  );

  // Determine if versioning actions should be shown
  const showVerifyAction = versionStatus === "unchecked" || versionStatus === "current";
  const showRefreshAction = versionStatus === "modified";
  const showRelinkAction = versionStatus === "missing" || dataset.status === "missing";

  const taskLabel = getDatasetTaskLabel(dataset.task_type, {
    short: true,
    numClasses: dataset.num_classes,
  });

  return (
    <motion.div
      className={`
        group relative flex items-stretch gap-4 pl-4 pr-3 py-3 rounded-xl border bg-card cursor-pointer
        transition-all duration-200 ease-out
        ${selected
          ? "border-primary/60 bg-primary/[0.04] shadow-sm shadow-primary/10"
          : "border-border/70 hover:border-primary/40 hover:shadow-sm hover:bg-accent/20"}
      `}
      onClick={() => onSelect?.(dataset)}
    >
      {/* Left accent bar — lights up on select/hover */}
      <span
        aria-hidden
        className={`
          absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full transition-all duration-200
          ${selected ? "bg-primary opacity-100" : "bg-primary opacity-0 group-hover:opacity-40"}
        `}
      />

      {/* Icon */}
      <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/10 flex-shrink-0 self-center">
        <FileSpreadsheet className="h-5 w-5 text-primary" />
      </div>

      {/* Identity (name + path) */}
      <div className="flex-1 min-w-0 self-center">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold text-foreground truncate tracking-tight">{dataset.name}</h3>
          <DatasetStatusBadge
            status={versionStatus}
            lastVerified={dataset.last_verified}
            hash={dataset.hash}
          />
          {repetitionColumn && (
            <Badge
              variant="outline"
              className="text-[10px]"
              title={`Repetition column: ${repetitionColumn}`}
            >
              {repetitionColumn}
            </Badge>
          )}
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
        <p className="text-xs text-muted-foreground/80 font-mono truncate mt-0.5">{dataset.path}</p>
      </div>

      {/* Vertical divider before the metrics grid */}
      <div aria-hidden className="hidden md:block w-px self-stretch bg-border/60" />

      {/*
        Metrics grid — fixed column widths so numbers align across cards.
        Columns (lg+):  score (160) | samples (96) | features (80) | task (96)
        Columns (md):                samples (96) | features (80) | task (96)
      */}
      <div
        className="
          hidden md:grid items-center flex-shrink-0 gap-x-6
          md:grid-cols-[96px_80px_96px]
          lg:grid-cols-[160px_96px_80px_96px]
        "
      >
        {/* Best Score (lg+ only) — always reserved, shows placeholder when absent */}
        <div className="hidden lg:flex flex-col items-end justify-center leading-tight">
          {bestScore ? (
            <>
              <div className="flex items-baseline gap-1.5">
                <span
                  className={`text-lg font-bold font-mono tabular-nums ${
                    bestScore.isFinal ? "text-emerald-500" : "text-chart-1"
                  }`}
                >
                  {formatScore(bestScore.score)}
                </span>
                <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                  {bestScore.metric === "balanced_accuracy" ? "B_Acc" : bestScore.metric}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5">
                <span
                  className={`font-semibold tracking-wider uppercase ${
                    bestScore.isFinal ? "text-emerald-500/80" : "text-chart-1/80"
                  }`}
                >
                  {bestScore.isFinal ? "Final" : "CV"}
                </span>
                {bestScore.model && (
                  <>
                    <span className="text-muted-foreground/40">·</span>
                    <span
                      className="font-mono truncate max-w-[90px]"
                      title={bestScore.model}
                    >
                      {bestScore.model}
                    </span>
                  </>
                )}
                {bestScore.isFinal && bestScore.cvScore != null && (
                  <>
                    <span className="text-muted-foreground/40">·</span>
                    <span className="font-mono tabular-nums">CV {formatScore(bestScore.cvScore)}</span>
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-end leading-tight">
              <span className="text-lg font-mono tabular-nums text-muted-foreground/30">—</span>
              <span className="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground/50 mt-0.5">
                No score
              </span>
            </div>
          )}
        </div>

        {/* Samples */}
        <div className="flex flex-col items-end leading-tight">
          <span className="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">
            Samples
          </span>
          <span className="font-semibold text-foreground font-mono tabular-nums text-sm mt-0.5">
            {formatNumber(dataset.num_samples)}
          </span>
          {dataset.test_samples != null && dataset.test_samples > 0 ? (
            <span className="text-[10px] text-muted-foreground tabular-nums font-mono">
              {formatNumber(dataset.train_samples)} / {formatNumber(dataset.test_samples)}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
              unsplit
            </span>
          )}
        </div>

        {/* Features */}
        <div className="flex flex-col items-end leading-tight min-w-0">
          <span className="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">
            Features
          </span>
          <span className="font-semibold text-foreground font-mono tabular-nums text-sm mt-0.5">
            {formatNumber(dataset.num_features)}
          </span>
          {(() => {
            const perSource = formatPerSource(dataset.num_features);
            if (perSource) {
              return (
                <span
                  className="text-[10px] text-muted-foreground tabular-nums font-mono truncate max-w-[80px]"
                  title={perSource}
                >
                  {perSource}
                </span>
              );
            }
            return <span className="text-[10px] text-transparent select-none">·</span>;
          })()}
        </div>

        {/* Task */}
        <div className="flex flex-col items-end leading-tight">
          <span className="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">
            Task
          </span>
          <span
            className="font-semibold text-foreground text-sm mt-0.5 truncate max-w-[96px]"
            title={taskLabel}
          >
            {taskLabel}
          </span>
          <span className="text-[10px] text-transparent select-none">·</span>
        </div>
      </div>

      {/* Divider before actions */}
      <div aria-hidden className="hidden md:block w-px self-stretch bg-border/60" />

      {/* Direct Action Buttons */}
      <div className="flex items-center gap-0.5 flex-shrink-0 self-center" onClick={(e) => e.stopPropagation()}>
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
