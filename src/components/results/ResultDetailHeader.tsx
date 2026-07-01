import { Link } from "react-router-dom";
import {
  Box,
  Database,
  ExternalLink,
  GitBranch,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  RuntimeEngineBadge,
  RuntimeRunStatePresentation,
  RuntimeStatusBadge,
  RuntimeStatusIconFrame,
} from "@/components/runtime";
import { useRuntimeResultPresentation } from "@/hooks/useRuntimeResultPresentation";
import type { PipelineRun } from "@/types/runs";
import {
  buildResultQuickFacts,
  type ResultQuickFactIcon,
} from "./resultDetailData";

interface ResultDetailHeaderProps {
  pipeline: PipelineRun;
  datasetName: string;
}

const quickFactIcons: Record<ResultQuickFactIcon, typeof Box> = {
  model: Box,
  preprocessing: Wrench,
  split: GitBranch,
};

export function ResultDetailHeader({ pipeline, datasetName }: ResultDetailHeaderProps) {
  const runtime = useRuntimeResultPresentation({
    source: pipeline,
    status: pipeline.status,
    progress: pipeline.progress,
  });
  const quickFacts = buildResultQuickFacts(pipeline);

  return (
    <SheetHeader className="flex-shrink-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <RuntimeStatusIconFrame status={pipeline.status} />
          <div>
            <SheetTitle className="text-lg">Result Details</SheetTitle>
            <SheetDescription className="mt-1 flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">
                {pipeline.pipeline_name}
              </span>
              <RuntimeEngineBadge status={runtime.engine} />
            </SheetDescription>
          </div>
        </div>
        <RuntimeStatusBadge status={pipeline.status} showIcon={false} />
      </div>

      <RuntimeRunStatePresentation status={pipeline.status} progress={pipeline.progress} className="mt-4" />

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
