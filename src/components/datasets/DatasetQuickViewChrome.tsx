import {
  Database,
  ExternalLink,
  Hash,
  Layers,
  Settings,
  Target,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Dataset } from "@/types/datasets";
import {
  formatNumber,
  type QuickViewCounts,
} from "./DatasetQuickViewData";

export function DatasetQuickViewHeader({
  dataset,
  onClose,
}: {
  dataset: Dataset;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border p-4 flex-shrink-0">
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold text-foreground truncate">{dataset.name}</h3>
        <p className="text-xs text-muted-foreground font-mono truncate">{dataset.path}</p>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0 ml-2">
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function DatasetQuickViewStats({
  dataset,
  counts,
}: {
  dataset: Dataset;
  counts: QuickViewCounts;
}) {
  const { numSamples, numFeatures, nSources, trainCount, testCount } = counts;

  return (
    <div className="grid grid-cols-4 gap-2 p-4 border-b border-border flex-shrink-0">
      <div className="text-center">
        <Layers className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
        <p className="text-sm font-semibold">{formatNumber(numSamples)}</p>
        <p className="text-xs text-muted-foreground">Samples</p>
        {testCount != null && testCount > 0 && (
          <p className="text-[10px] text-muted-foreground tabular-nums">
            {formatNumber(trainCount)} / {formatNumber(testCount)}
          </p>
        )}
      </div>
      <div className="text-center">
        <Hash className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
        <p className="text-sm font-semibold">{formatNumber(numFeatures)}</p>
        <p className="text-xs text-muted-foreground">Features</p>
      </div>
      <div className="text-center">
        <Target className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
        <p className="text-sm font-semibold">{dataset.targets?.length || "--"}</p>
        <p className="text-xs text-muted-foreground">Targets</p>
      </div>
      <div className="text-center">
        <Database className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
        <p className="text-sm font-semibold">{nSources}</p>
        <p className="text-xs text-muted-foreground">Sources</p>
      </div>
    </div>
  );
}

export function DatasetQuickViewFooter({
  dataset,
  onEdit,
  onOpenDetails,
}: {
  dataset: Dataset;
  onEdit?: (dataset: Dataset) => void;
  onOpenDetails: (dataset: Dataset) => void;
}) {
  return (
    <div className="border-t border-border p-4 flex gap-2 flex-shrink-0">
      {onEdit && (
        <Button variant="outline" size="sm" className="flex-1" onClick={() => onEdit(dataset)}>
          <Settings className="h-4 w-4 mr-2" />
          Edit
        </Button>
      )}
      <Button variant="outline" size="sm" className="flex-1" onClick={() => onOpenDetails(dataset)}>
        <ExternalLink className="h-4 w-4 mr-2" />
        Open Details
      </Button>
    </div>
  );
}
