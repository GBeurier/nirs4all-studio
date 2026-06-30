import { sortInspectorChainsByScore } from "@/lib/inspector/scoreAccess";
import { getResultAnalysisChains, type ResultAnalysisStore } from "@/lib/inspector/resultAnalysisStore";
import type { InspectorChainSummary, ScoreColumn } from "@/types/inspector";

export type InspectorFocusMode = "selection" | "pinned" | "top";
export type InspectorFocusTask = "none" | "classification" | "regression" | "mixed";

export interface InspectorFocusLabelChain {
  chain_id: string;
  label: string;
}

export interface InspectorFocusState {
  sortedChains: InspectorChainSummary[];
  orderedVisibleIds: string[];
  selectedVisibleIds: string[];
  pinnedVisibleIds: string[];
  chainIds: string[];
  chains: InspectorChainSummary[];
  labelChains: InspectorFocusLabelChain[];
  mode: InspectorFocusMode;
  task: InspectorFocusTask;
  topologyPipelineId: string | null;
}

export interface InspectorFocusOptions {
  chains: readonly InspectorChainSummary[];
  scoreColumn: ScoreColumn;
  selectedChainIds: ReadonlySet<string>;
  pinnedChainIds: ReadonlySet<string>;
  limit: number;
}

export interface InspectorFocusFromStoreOptions extends Omit<InspectorFocusOptions, "chains"> {
  store: ResultAnalysisStore;
}

export function isInspectorClassificationTask(taskType: string | null | undefined): boolean {
  return taskType === "classification" || taskType === "binary_classification" || taskType === "multiclass_classification";
}

export function getInspectorFocusTask(chains: readonly InspectorChainSummary[]): InspectorFocusTask {
  if (chains.length === 0) return "none";
  const classificationCount = chains.filter((chain) => isInspectorClassificationTask(chain.task_type)).length;
  if (classificationCount === chains.length) return "classification";
  if (classificationCount === 0) return "regression";
  return "mixed";
}

export function buildInspectorFocusState({
  chains,
  scoreColumn,
  selectedChainIds,
  pinnedChainIds,
  limit,
}: InspectorFocusOptions): InspectorFocusState {
  const sortedChains = sortInspectorChainsByScore(chains, scoreColumn);
  const orderedVisibleIds = sortedChains.map((chain) => chain.chain_id);
  const selectedVisibleIds = orderedVisibleIds
    .filter((chainId) => selectedChainIds.has(chainId))
    .slice(0, limit);
  const pinnedVisibleIds = orderedVisibleIds
    .filter((chainId) => pinnedChainIds.has(chainId) && !selectedChainIds.has(chainId))
    .slice(0, limit);

  let mode: InspectorFocusMode = "top";
  let chainIds = sortedChains.slice(0, limit).map((chain) => chain.chain_id);
  if (selectedVisibleIds.length > 0) {
    mode = "selection";
    chainIds = selectedVisibleIds;
  } else if (pinnedVisibleIds.length > 0) {
    mode = "pinned";
    chainIds = pinnedVisibleIds;
  }

  const chainMap = new Map(chains.map((chain) => [chain.chain_id, chain]));
  const focusChains = chainIds
    .map((chainId) => chainMap.get(chainId))
    .filter((chain): chain is InspectorChainSummary => Boolean(chain));
  const focusPipelineIds = [...new Set(focusChains.map((chain) => chain.pipeline_id).filter(Boolean))];

  return {
    sortedChains,
    orderedVisibleIds,
    selectedVisibleIds,
    pinnedVisibleIds,
    chainIds,
    chains: focusChains,
    labelChains: focusChains.map((chain) => ({
      chain_id: chain.chain_id,
      label: chain.model_name ?? chain.model_class,
    })),
    mode,
    task: getInspectorFocusTask(focusChains),
    topologyPipelineId: focusPipelineIds.length === 1 ? focusPipelineIds[0] : null,
  };
}

export function buildInspectorFocusStateFromStore({
  store,
  scoreColumn,
  selectedChainIds,
  pinnedChainIds,
  limit,
}: InspectorFocusFromStoreOptions): InspectorFocusState {
  return buildInspectorFocusState({
    chains: getResultAnalysisChains(store),
    scoreColumn,
    selectedChainIds,
    pinnedChainIds,
    limit,
  });
}
