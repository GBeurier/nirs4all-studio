import { Link } from "react-router-dom";
import {
  AlertCircle,
  Box,
  CheckCircle2,
  CircleDashed,
  Clock,
  Database,
  ExternalLink,
  GitBranch,
  RefreshCw,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { PipelineRun, RunStatus } from "@/types/runs";
import {
  buildResultHeaderStatus,
  buildResultQuickFacts,
  type ResultQuickFactIcon,
} from "./resultDetailData";

interface ResultDetailHeaderProps {
  pipeline: PipelineRun;
  datasetName: string;
}

const statusIcons: Record<RunStatus, typeof Clock> = {
  queued: Clock,
  running: RefreshCw,
  completed: CheckCircle2,
  failed: AlertCircle,
  partial: CircleDashed,
};

const quickFactIcons: Record<ResultQuickFactIcon, typeof Box> = {
  model: Box,
  preprocessing: Wrench,
  split: GitBranch,
};

function ResultDetailStatusIcon({
  status,
  colorClass,
  iconClass,
}: {
  status: RunStatus;
  colorClass: string;
  iconClass: string;
}) {
  const Icon = statusIcons[status];
  return (
    <Icon className={cn("h-4 w-4", colorClass, iconClass)} />
  );
}

export function ResultDetailHeader({ pipeline, datasetName }: ResultDetailHeaderProps) {
  const status = buildResultHeaderStatus(pipeline);
  const quickFacts = buildResultQuickFacts(pipeline);

  return (
    <SheetHeader className="flex-shrink-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn("p-2 rounded-lg", status.bgClass)}>
            <ResultDetailStatusIcon
              status={pipeline.status}
              colorClass={status.colorClass}
              iconClass={status.iconClass}
            />
          </div>
          <div>
            <SheetTitle className="text-lg">Result Details</SheetTitle>
            <SheetDescription className="flex items-center gap-2 mt-1">
              <span className="text-sm font-medium text-foreground">
                {pipeline.pipeline_name}
              </span>
            </SheetDescription>
          </div>
        </div>
        <Badge variant={status.badgeVariant}>
          {status.label}
        </Badge>
      </div>

      {status.progress != null && (
        <div className="mt-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Progress</span>
            <span className="font-medium">{status.progress}%</span>
          </div>
          <Progress value={status.progress} className="h-2" />
        </div>
      )}

      <div className="mt-4 p-3 rounded-lg bg-muted/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">{datasetName}</span>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/datasets/${encodeURIComponent(datasetName)}`}>
            <ExternalLink className="h-3.5 w-3.5 mr-1" />
            View Dataset
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3 mt-4">
        {quickFacts.map((fact) => {
          const Icon = quickFactIcons[fact.icon];
          return (
            <div key={fact.id} className="p-3 rounded-lg bg-muted/30 text-center">
              <Icon className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
              <p className="text-sm font-semibold">{fact.value}</p>
              <p className="text-xs text-muted-foreground">{fact.label}</p>
            </div>
          );
        })}
      </div>
    </SheetHeader>
  );
}
