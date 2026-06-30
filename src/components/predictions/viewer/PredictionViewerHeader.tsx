import {
  Brain,
  Database,
  Layers,
  ScatterChart as ScatterIcon,
} from "lucide-react";
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import type { ViewerHeader } from "./types";

interface PredictionViewerHeaderProps {
  description: string;
  header: ViewerHeader;
  title: string;
}

export function PredictionViewerHeader({
  description,
  header,
  title,
}: PredictionViewerHeaderProps) {
  return (
    <DialogHeader className="border-b px-5 py-3">
      <DialogTitle className="flex items-center gap-2 text-base">
        <ScatterIcon className="h-4 w-4 text-primary" />
        <span className="truncate">{title || "Prediction viewer"}</span>
      </DialogTitle>
      <DialogDescription className="sr-only">{description}</DialogDescription>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Database className="h-3.5 w-3.5" />
          {header.datasetName}
        </span>
        {header.modelName && (
          <span className="inline-flex items-center gap-1">
            <Brain className="h-3.5 w-3.5 text-primary" />
            <Badge variant="outline" className="h-5 px-1.5">
              {header.modelName}
            </Badge>
          </span>
        )}
        {header.preprocessings && (
          <span className="inline-flex items-center gap-1">
            <Layers className="h-3.5 w-3.5" />
            {header.preprocessings}
          </span>
        )}
        {header.foldId && <span>Fold: {header.foldId}</span>}
      </div>
    </DialogHeader>
  );
}
