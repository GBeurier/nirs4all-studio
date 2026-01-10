/**
 * PipelineCard component for grid view
 * Phase 6: Pipelines Library
 */

import { Link } from "react-router-dom";
import { motion } from "@/lib/motion";
import {
  GitBranch,
  Star,
  StarOff,
  MoreVertical,
  Play,
  Copy,
  Trash2,
  Download,
  Clock,
  Layers,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Pipeline } from "@/types/pipelines";

interface PipelineCardProps {
  pipeline: Pipeline;
  onToggleFavorite: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onExport: () => void;
}

const categoryConfig = {
  user: { label: "My Pipeline", color: "text-primary bg-primary/10" },
  preset: { label: "Preset", color: "text-accent bg-accent/10" },
  shared: { label: "Shared", color: "text-success bg-success/10" },
};

const statusConfig = {
  success: { icon: CheckCircle2, color: "text-success" },
  failed: { icon: XCircle, color: "text-destructive" },
  running: { icon: Clock, color: "text-warning animate-pulse" },
  pending: { icon: Clock, color: "text-muted-foreground" },
};

export function PipelineCard({
  pipeline,
  onToggleFavorite,
  onDuplicate,
  onDelete,
  onExport,
}: PipelineCardProps) {
  return (
    <motion.div
      className="step-card group"
      whileHover={{ scale: 1.005 }}
      layout
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div
          className={cn(
            "px-2 py-0.5 rounded text-xs font-medium",
            categoryConfig[pipeline.category].color
          )}
        >
          {categoryConfig[pipeline.category].label}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onToggleFavorite}
            className="p-1 rounded hover:bg-muted transition-colors"
          >
            {pipeline.isFavorite ? (
              <Star className="h-4 w-4 text-warning fill-warning" />
            ) : (
              <StarOff className="h-4 w-4 text-muted-foreground hover:text-warning transition-colors" />
            )}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="p-1 rounded hover:bg-muted transition-colors">
                <MoreVertical className="h-4 w-4 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to={`/pipelines/${pipeline.id}`} className="flex items-center">
                  <Play className="mr-2 h-4 w-4" /> Open & Edit
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicate}>
                <Copy className="mr-2 h-4 w-4" /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onExport}>
                <Download className="mr-2 h-4 w-4" /> Export JSON
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {pipeline.category === "user" && (
                <DropdownMenuItem onClick={onDelete} className="text-destructive">
                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Main content */}
      <Link to={`/pipelines/${pipeline.id}`} className="block">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <GitBranch className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-foreground truncate group-hover:text-primary transition-colors">
              {pipeline.name}
            </h3>
            <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">
              {pipeline.description || "No description"}
            </p>
          </div>
        </div>
      </Link>

      {/* Footer stats */}
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/50">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Layers className="h-3 w-3" /> {pipeline.steps.length} steps
          </span>
          {pipeline.runCount !== undefined && pipeline.runCount > 0 && (
            <span className="flex items-center gap-1">
              <Play className="h-3 w-3" /> {pipeline.runCount} runs
            </span>
          )}
        </div>
        {pipeline.lastRunStatus && (
          <div className="flex items-center gap-1">
            {(() => {
              const Status = statusConfig[pipeline.lastRunStatus];
              return <Status.icon className={cn("h-3.5 w-3.5", Status.color)} />;
            })()}
          </div>
        )}
      </div>

      {/* Tags */}
      {pipeline.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {pipeline.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="text-xs px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground"
            >
              {tag}
            </span>
          ))}
          {pipeline.tags.length > 3 && (
            <span className="text-xs px-1.5 py-0.5 text-muted-foreground">
              +{pipeline.tags.length - 3}
            </span>
          )}
        </div>
      )}
    </motion.div>
  );
}
