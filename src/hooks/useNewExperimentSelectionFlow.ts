import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";

import type { PipelineInfo } from "@/api/pipelines";
import {
  buildAllPipelineOptions,
  CURRENT_EDITED_PIPELINE_ID,
  type CurrentEditedPipeline,
  type ExperimentPipelineOption,
} from "@/lib/experimentPipelineSelection";
import type { PipelineFilterMode } from "@/lib/experimentInputFilters";
import { consumeCurrentEditedPipelineHandoffFromClientStorage } from "@/lib/pipelineExperimentHandoff";

export interface UseNewExperimentSelectionFlowInput {
  savedPipelineOptions: ExperimentPipelineOption[];
  rawPipelines?: PipelineInfo[];
  searchParams: URLSearchParams;
  onEditorRedirect: () => void;
}

export interface UseNewExperimentSelectionFlowResult {
  allPipelineOptions: ExperimentPipelineOption[];
  currentEditedPipeline: CurrentEditedPipeline | null;
  datasetSearch: string;
  pipelineFilter: PipelineFilterMode;
  pipelineSearch: string;
  selectedDatasetIds: string[];
  selectedPipelineIds: string[];
  splitGroupByByDataset: Record<string, string | null>;
  setDatasetSearch: (value: string) => void;
  setPipelineFilter: (value: PipelineFilterMode) => void;
  setPipelineSearch: (value: string) => void;
  setSplitGroupByByDataset: Dispatch<SetStateAction<Record<string, string | null>>>;
  toggleDataset: (id: string) => void;
  togglePipeline: (id: string) => void;
}

export function useNewExperimentSelectionFlow({
  savedPipelineOptions,
  rawPipelines,
  searchParams,
  onEditorRedirect,
}: UseNewExperimentSelectionFlowInput): UseNewExperimentSelectionFlowResult {
  const [selectedDatasetIds, setSelectedDatasetIds] = useState<string[]>([]);
  const [selectedPipelineIds, setSelectedPipelineIds] = useState<string[]>([]);
  const [splitGroupByByDataset, setSplitGroupByByDataset] = useState<Record<string, string | null>>({});
  const [datasetSearch, setDatasetSearch] = useState("");
  const [pipelineSearch, setPipelineSearch] = useState("");
  const [pipelineFilter, setPipelineFilter] = useState<PipelineFilterMode>("all");
  const [currentEditedPipeline, setCurrentEditedPipeline] = useState<CurrentEditedPipeline | null>(null);
  const handledRouteSelectionRef = useRef<string | null>(null);

  const allPipelineOptions = useMemo(
    () => buildAllPipelineOptions(currentEditedPipeline, savedPipelineOptions),
    [currentEditedPipeline, savedPipelineOptions],
  );

  useEffect(() => {
    const pipelineId = searchParams.get("pipeline");
    const source = searchParams.get("source");
    const routeSelectionKey = `${source ?? ""}:${pipelineId ?? ""}`;

    if (handledRouteSelectionRef.current === routeSelectionKey) return;

    if (source === "editor") {
      handledRouteSelectionRef.current = routeSelectionKey;
      const handoff = consumeCurrentEditedPipelineHandoffFromClientStorage();
      if (handoff) {
        setCurrentEditedPipeline(handoff);
        setSelectedPipelineIds([CURRENT_EDITED_PIPELINE_ID]);
        toast.info(`Pipeline "${handoff.name}" ready for experiment`);
      }
      onEditorRedirect();
      return;
    }

    if (!pipelineId || !rawPipelines) return;

    handledRouteSelectionRef.current = routeSelectionKey;
    const pipeline = rawPipelines.find((candidate) => candidate.id === pipelineId);
    if (pipeline && !selectedPipelineIds.includes(pipelineId)) {
      setSelectedPipelineIds([pipelineId]);
      toast.info(`Pipeline "${pipeline.name}" selected`);
    }
    onEditorRedirect();
  }, [onEditorRedirect, rawPipelines, searchParams, selectedPipelineIds]);

  const toggleDataset = useCallback((id: string) => {
    setSelectedDatasetIds((current) => {
      const selected = current.includes(id);
      setSplitGroupByByDataset((groups) => {
        if (selected) {
          const next = { ...groups };
          delete next[id];
          return next;
        }
        return id in groups ? groups : { ...groups, [id]: null };
      });
      return selected ? current.filter((datasetId) => datasetId !== id) : [...current, id];
    });
  }, []);

  const togglePipeline = useCallback((id: string) => {
    setSelectedPipelineIds((current) =>
      current.includes(id)
        ? current.filter((pipelineId) => pipelineId !== id)
        : [...current, id],
    );
  }, []);

  return {
    allPipelineOptions,
    currentEditedPipeline,
    datasetSearch,
    pipelineFilter,
    pipelineSearch,
    selectedDatasetIds,
    selectedPipelineIds,
    splitGroupByByDataset,
    setDatasetSearch,
    setPipelineFilter,
    setPipelineSearch,
    setSplitGroupByByDataset,
    toggleDataset,
    togglePipeline,
  };
}
