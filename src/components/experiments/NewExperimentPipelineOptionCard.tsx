import { Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { ExperimentPipelineOption } from "@/lib/experimentPipelineSelection";
import {
  buildExperimentPipelineSelectionChipLabels,
  buildExperimentPipelineSelectionBadges,
  buildExperimentPipelineSelectionDetails,
  experimentSelectionCopy,
} from "@/lib/experimentSelectionPresentation";

import { NewExperimentSelectionDetailChips } from "./NewExperimentSelectionDetailChips";
import { NewExperimentSelectableOptionCard } from "./NewExperimentSelectableOptionCard";

export interface NewExperimentPipelineOptionCardProps {
  pipeline: ExperimentPipelineOption;
  selected: boolean;
  onTogglePipeline: (pipelineId: string) => void;
}

export function NewExperimentPipelineOptionCard({
  pipeline,
  selected,
  onTogglePipeline,
}: NewExperimentPipelineOptionCardProps) {
  const badges = buildExperimentPipelineSelectionBadges(pipeline);
  const details = buildExperimentPipelineSelectionDetails(pipeline);
  const detailChipLabels = buildExperimentPipelineSelectionChipLabels(details);

  return (
    <NewExperimentSelectableOptionCard
      dataAttributeName="data-experiment-pipeline-id"
      optionId={pipeline.id}
      selected={selected}
      onToggle={onTogglePipeline}
    >
      <div className="flex items-center gap-2">
        <p className="font-medium text-foreground">{pipeline.name}</p>
        {badges.showFavorite && <Star className="h-3 w-3 fill-chart-2 text-chart-2" />}
        {badges.showPreset && (
          <Badge variant="outline" className="text-xs">{experimentSelectionCopy.pipelinePresetBadge}</Badge>
        )}
      </div>
      <code className="text-sm text-muted-foreground">{details.stepSummaryLabel}</code>
      <NewExperimentSelectionDetailChips labels={detailChipLabels} />
    </NewExperimentSelectableOptionCard>
  );
}
