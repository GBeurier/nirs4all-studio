import { useTranslation } from "react-i18next";
import { Filter } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PipelineFilterMode } from "@/lib/experimentInputFilters";
import { experimentSelectionCopy } from "@/lib/experimentSelectionPresentation";

export interface NewExperimentPipelineFilterSelectProps {
  value: PipelineFilterMode;
  onValueChange: (value: PipelineFilterMode) => void;
}

export function NewExperimentPipelineFilterSelect({
  value,
  onValueChange,
}: NewExperimentPipelineFilterSelectProps) {
  const { t } = useTranslation();

  return (
    <Select value={value} onValueChange={(nextValue: PipelineFilterMode) => onValueChange(nextValue)}>
      <SelectTrigger className="w-40" aria-label={t("newExperiment.selection.filterPipelinesAria")}>
        <Filter className="mr-2 h-4 w-4" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{experimentSelectionCopy.pipelineFilterAll}</SelectItem>
        <SelectItem value="favorites">{experimentSelectionCopy.pipelineFilterFavorites}</SelectItem>
        <SelectItem value="presets">{experimentSelectionCopy.pipelineFilterPresets}</SelectItem>
      </SelectContent>
    </Select>
  );
}
