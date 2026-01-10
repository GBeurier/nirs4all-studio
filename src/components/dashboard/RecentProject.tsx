import { Link } from "react-router-dom";
import { motion } from "@/lib/motion";
import { Clock, CheckCircle2, Loader2, XCircle, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type ProjectStatus = "completed" | "running" | "failed" | "pending";

interface RecentProjectProps {
  id: string;
  name: string;
  dataset: string;
  lastRun: string;
  status: ProjectStatus;
  metric?: { name: string; value: number };
  href?: string;
}

const statusConfig: Record<
  ProjectStatus,
  {
    icon: typeof CheckCircle2;
    label: string;
    className: string;
  }
> = {
  completed: {
    icon: CheckCircle2,
    label: "Completed",
    className: "text-success",
  },
  running: {
    icon: Loader2,
    label: "Running",
    className: "text-primary animate-spin",
  },
  failed: {
    icon: XCircle,
    label: "Failed",
    className: "text-destructive",
  },
  pending: {
    icon: AlertCircle,
    label: "Pending",
    className: "text-warning",
  },
};

export function RecentProject({
  id,
  name,
  dataset,
  lastRun,
  status,
  metric,
  href,
}: RecentProjectProps) {
  const StatusIcon = statusConfig[status].icon;

  const content = (
    <motion.div
      whileHover={{ scale: 1.01 }}
      className="step-card cursor-pointer"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-foreground truncate">{name}</h3>
          <p className="mt-1 text-sm text-muted-foreground font-mono truncate">
            {dataset}
          </p>
        </div>
        <div className="flex items-center gap-1 ml-2">
          <StatusIcon
            className={cn("h-5 w-5 flex-shrink-0", statusConfig[status].className)}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-border/50 pt-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          <span>{lastRun}</span>
        </div>
        {metric && status === "completed" && (
          <div className="rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
            {metric.name} = {metric.value.toFixed(2)}
          </div>
        )}
        {status === "running" && (
          <div className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
            In progress...
          </div>
        )}
        {status === "failed" && (
          <div className="rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
            Error
          </div>
        )}
      </div>
    </motion.div>
  );

  if (href) {
    return <Link to={href}>{content}</Link>;
  }

  return content;
}
