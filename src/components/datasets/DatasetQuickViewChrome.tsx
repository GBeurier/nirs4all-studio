import { useTranslation } from "react-i18next";
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
import type { MultimodalDatasetSummary } from "@/lib/multimodalDatasetSummary";
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
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between border-b border-border p-4 flex-shrink-0">
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold text-foreground truncate">{dataset.name}</h3>
        <p className="text-xs text-muted-foreground font-mono truncate">{dataset.path}</p>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0 ml-2">
        <Button variant="ghost" size="icon" aria-label={t("common.close")} onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function DatasetQuickViewStats({
  dataset,
  counts,
  multimodal,
}: {
  dataset: Dataset;
  counts: QuickViewCounts;
  multimodal?: MultimodalDatasetSummary | null;
}) {
  const { t } = useTranslation();
  const { numSamples, numFeatures, nSources, trainCount, testCount } = counts;
  const partitionCounts = multimodal && Object.entries(multimodal.partitions)
    .map(([name, count]) => `${name}: ${formatNumber(count)}`)
    .join(" · ");

  return (
    <div className="grid grid-cols-4 gap-2 p-4 border-b border-border flex-shrink-0">
      <div className="text-center">
        <Layers className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
        <p className="text-sm font-semibold">{formatNumber(multimodal?.samples ?? numSamples)}</p>
        <p className="text-xs text-muted-foreground">{t("datasets.info.samples")}</p>
        {multimodal ? (partitionCounts && <p className="text-[10px] text-muted-foreground tabular-nums">{partitionCounts}</p>) : testCount != null && testCount > 0 && (
          <p className="text-[10px] text-muted-foreground tabular-nums">
            {formatNumber(trainCount)} / {formatNumber(testCount)}
          </p>
        )}
      </div>
      <div className="text-center">
        <Hash className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
        <p className="text-sm font-semibold">{multimodal ? multimodal.alignment : formatNumber(numFeatures)}</p>
        <p className="text-xs text-muted-foreground">{multimodal ? t("datasets.detailPage.stats.alignment") : t("datasets.info.features")}</p>
      </div>
      <div className="text-center">
        <Target className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
        <p className="text-sm font-semibold">{multimodal ? multimodal.targets.length : dataset.targets?.length || "--"}</p>
        <p className="text-xs text-muted-foreground">{t("datasets.info.targets")}</p>
      </div>
      <div className="text-center">
        <Database className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
        <p className="text-sm font-semibold">{multimodal?.sources.length ?? nSources}</p>
        <p className="text-xs text-muted-foreground">{t("datasets.detailPage.stats.sources")}</p>
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
  const { t } = useTranslation();
  return (
    <div className="border-t border-border p-4 flex gap-2 flex-shrink-0">
      {onEdit && (
        <Button variant="outline" size="sm" className="flex-1" onClick={() => onEdit(dataset)}>
          <Settings className="h-4 w-4 mr-2" />
          {t("common.edit")}
        </Button>
      )}
      <Button variant="outline" size="sm" className="flex-1" onClick={() => onOpenDetails(dataset)}>
        <ExternalLink className="h-4 w-4 mr-2" />
        {t("datasets.quickView.openDetails")}
      </Button>
    </div>
  );
}
