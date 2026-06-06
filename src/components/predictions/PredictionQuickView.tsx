import type { PredictionRecord } from "@/types/linked-workspaces";
import { PredictionViewer } from "@/components/predictions/viewer/PredictionViewer";
import type {
  ChartKind,
  ViewerHeader,
  ViewerPartitionTarget,
} from "@/components/predictions/viewer/types";

interface PredictionQuickViewProps {
  prediction: PredictionRecord | null;
  siblings: PredictionRecord[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  initialKind: ChartKind;
}

export function PredictionQuickView({
  prediction,
  siblings,
  open,
  onOpenChange,
  workspaceId,
  initialKind,
}: PredictionQuickViewProps) {
  if (!prediction) return null;

  const viewerPartitions: ViewerPartitionTarget[] = siblings.map(r => ({
    predictionId: r.id,
    partition: (r.partition || "").toLowerCase(),
    label: r.partition || "",
    source: "workspace" as const,
  }));

  const viewerHeader: ViewerHeader = {
    datasetName: prediction.source_dataset || prediction.dataset_name || "",
    modelName: prediction.model_name || null,
    preprocessings: prediction.preprocessings || null,
    foldId: prediction.fold_id || null,
    taskType: prediction.task_type || null,
    valScore: prediction.val_score ?? null,
    testScore: prediction.test_score ?? null,
    trainScore: prediction.train_score ?? null,
    nSamples: prediction.n_samples ?? null,
    nFeatures: prediction.n_features ?? null,
  };

  return (
    <PredictionViewer
      open={open}
      onOpenChange={onOpenChange}
      header={viewerHeader}
      partitions={viewerPartitions}
      workspaceId={workspaceId}
      initialKind={initialKind}
    />
  );
}
