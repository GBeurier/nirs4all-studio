import {
  getResultAnalysisGroupLabel,
  type ResultAnalysisGroupField,
} from "@/lib/inspector/resultAnalysisDimensions";
import {
  getInspectorFiniteScore,
  isInspectorLowerBetter,
} from "@/lib/inspector/scoreAccess";
import type { InspectorChainSummary, ScoreColumn } from "@/types/inspector";

export interface ResultAnalysisScoredView {
  scoreColumn?: ScoreColumn;
  chains: readonly InspectorChainSummary[];
}

export interface ResultAnalysisRobustnessGroup {
  key: string;
  label: string;
  chainIds: string[];
  count: number;
  finiteScoreCount: number;
  missingScoreCount: number;
  bestChainId: string | null;
  bestScore: number | null;
  worstChainId: string | null;
  worstScore: number | null;
  meanScore: number | null;
  scoreRange: [number, number] | null;
}

export interface ResultAnalysisRobustnessViewModelOptions {
  groupField: ResultAnalysisGroupField;
  scoreColumn?: ScoreColumn;
  lowerBetter?: boolean;
}

export interface ResultAnalysisRobustnessViewModel<TView extends ResultAnalysisScoredView = ResultAnalysisScoredView> {
  view: TView;
  scoreColumn: ScoreColumn;
  groupField: ResultAnalysisGroupField;
  lowerBetter: boolean;
  groups: ResultAnalysisRobustnessGroup[];
  groupByKey: ReadonlyMap<string, ResultAnalysisRobustnessGroup>;
}

export interface ResultAnalysisComplementarityEntry {
  candidateKey: string;
  contextKey: string;
  chainId: string;
  score: number;
}

export interface ResultAnalysisComplementarityPair {
  leftKey: string;
  rightKey: string;
  sharedContextCount: number;
  leftWins: number;
  rightWins: number;
  ties: number;
  comparedContextKeys: string[];
  leftScoreMean: number | null;
  rightScoreMean: number | null;
}

export interface ResultAnalysisComplementarityViewModelOptions {
  candidateField: ResultAnalysisGroupField;
  contextField: ResultAnalysisGroupField;
  scoreColumn?: ScoreColumn;
  lowerBetter?: boolean;
}

export interface ResultAnalysisComplementarityViewModel<TView extends ResultAnalysisScoredView = ResultAnalysisScoredView> {
  view: TView;
  scoreColumn: ScoreColumn;
  candidateField: ResultAnalysisGroupField;
  contextField: ResultAnalysisGroupField;
  lowerBetter: boolean;
  candidateKeys: string[];
  contextKeys: string[];
  entries: ResultAnalysisComplementarityEntry[];
  entryByKey: ReadonlyMap<string, ResultAnalysisComplementarityEntry>;
  pairs: ResultAnalysisComplementarityPair[];
}

export function getResultAnalysisMeanScore(scores: readonly number[]): number | null {
  if (scores.length === 0) return null;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

export function getResultAnalysisScoreRange(scores: readonly number[]): [number, number] | null {
  if (scores.length === 0) return null;
  return [Math.min(...scores), Math.max(...scores)];
}

export function getResultAnalysisInternalCellKey(rowKey: string, columnKey: string): string {
  return `${rowKey}\u0000${columnKey}`;
}

export function getResultAnalysisDisplayCellKey(rowKey: string, columnKey: string): string {
  return `${rowKey}::${columnKey}`;
}

export function isPreferredResultAnalysisScore(
  candidateScore: number,
  currentScore: number | null,
  candidateChainId: string,
  currentChainId: string | null,
  lowerBetter: boolean,
): boolean {
  if (currentScore == null) return true;
  if (candidateScore === currentScore) {
    return currentChainId == null || candidateChainId.localeCompare(currentChainId) < 0;
  }
  return lowerBetter ? candidateScore < currentScore : candidateScore > currentScore;
}

export function buildResultAnalysisRobustnessViewModel<TView extends ResultAnalysisScoredView>(
  view: TView,
  {
    groupField,
    scoreColumn = view.scoreColumn,
    lowerBetter,
  }: ResultAnalysisRobustnessViewModelOptions,
): ResultAnalysisRobustnessViewModel<TView> {
  if (!scoreColumn) {
    throw new Error("buildResultAnalysisRobustnessViewModel requires a score column");
  }

  const inferredLowerBetter = lowerBetter ?? isInspectorLowerBetter(view.chains);
  const grouped = new Map<string, {
    chainIds: string[];
    scores: number[];
    bestChainId: string | null;
    bestScore: number | null;
    worstChainId: string | null;
    worstScore: number | null;
  }>();

  for (const chain of view.chains) {
    const key = getResultAnalysisGroupLabel(chain, groupField);
    const current = grouped.get(key) ?? {
      chainIds: [],
      scores: [],
      bestChainId: null,
      bestScore: null,
      worstChainId: null,
      worstScore: null,
    };
    current.chainIds.push(chain.chain_id);

    const score = getInspectorFiniteScore(chain, scoreColumn);
    if (score != null) {
      current.scores.push(score);
      if (isPreferredResultAnalysisScore(score, current.bestScore, chain.chain_id, current.bestChainId, inferredLowerBetter)) {
        current.bestScore = score;
        current.bestChainId = chain.chain_id;
      }
      if (isPreferredResultAnalysisScore(score, current.worstScore, chain.chain_id, current.worstChainId, !inferredLowerBetter)) {
        current.worstScore = score;
        current.worstChainId = chain.chain_id;
      }
    }

    grouped.set(key, current);
  }

  const groups = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, current]): ResultAnalysisRobustnessGroup => ({
      key,
      label: key,
      chainIds: current.chainIds,
      count: current.chainIds.length,
      finiteScoreCount: current.scores.length,
      missingScoreCount: current.chainIds.length - current.scores.length,
      bestChainId: current.bestChainId,
      bestScore: current.bestScore,
      worstChainId: current.worstChainId,
      worstScore: current.worstScore,
      meanScore: getResultAnalysisMeanScore(current.scores),
      scoreRange: getResultAnalysisScoreRange(current.scores),
    }));

  return {
    view,
    scoreColumn,
    groupField,
    lowerBetter: inferredLowerBetter,
    groups,
    groupByKey: new Map(groups.map(group => [group.key, group])),
  };
}

export function buildResultAnalysisComplementarityViewModel<TView extends ResultAnalysisScoredView>(
  view: TView,
  {
    candidateField,
    contextField,
    scoreColumn = view.scoreColumn,
    lowerBetter,
  }: ResultAnalysisComplementarityViewModelOptions,
): ResultAnalysisComplementarityViewModel<TView> {
  if (!scoreColumn) {
    throw new Error("buildResultAnalysisComplementarityViewModel requires a score column");
  }
  if (candidateField === contextField) {
    throw new Error("buildResultAnalysisComplementarityViewModel requires distinct candidate and context fields");
  }

  const inferredLowerBetter = lowerBetter ?? isInspectorLowerBetter(view.chains);
  const candidateKeys = new Set<string>();
  const contextKeys = new Set<string>();
  const bestByInternalKey = new Map<string, ResultAnalysisComplementarityEntry>();

  for (const chain of view.chains) {
    const candidateKey = getResultAnalysisGroupLabel(chain, candidateField);
    const contextKey = getResultAnalysisGroupLabel(chain, contextField);
    candidateKeys.add(candidateKey);
    contextKeys.add(contextKey);

    const score = getInspectorFiniteScore(chain, scoreColumn);
    if (score == null) continue;

    const key = getResultAnalysisInternalCellKey(candidateKey, contextKey);
    const current = bestByInternalKey.get(key);
    if (!current || isPreferredResultAnalysisScore(score, current.score, chain.chain_id, current.chainId, inferredLowerBetter)) {
      bestByInternalKey.set(key, {
        candidateKey,
        contextKey,
        chainId: chain.chain_id,
        score,
      });
    }
  }

  const sortedCandidateKeys = [...candidateKeys].sort((left, right) => left.localeCompare(right));
  const sortedContextKeys = [...contextKeys].sort((left, right) => left.localeCompare(right));
  const entries = [...bestByInternalKey.values()].sort((left, right) => {
    const candidateComparison = left.candidateKey.localeCompare(right.candidateKey);
    if (candidateComparison !== 0) return candidateComparison;
    return left.contextKey.localeCompare(right.contextKey);
  });
  const entryByKey = new Map(entries.map(entry => [getResultAnalysisDisplayCellKey(entry.candidateKey, entry.contextKey), entry]));
  const pairs: ResultAnalysisComplementarityPair[] = [];

  for (let leftIndex = 0; leftIndex < sortedCandidateKeys.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sortedCandidateKeys.length; rightIndex += 1) {
      const leftKey = sortedCandidateKeys[leftIndex];
      const rightKey = sortedCandidateKeys[rightIndex];
      const comparedContextKeys: string[] = [];
      const leftScores: number[] = [];
      const rightScores: number[] = [];
      let leftWins = 0;
      let rightWins = 0;
      let ties = 0;

      for (const contextKey of sortedContextKeys) {
        const leftEntry = entryByKey.get(getResultAnalysisDisplayCellKey(leftKey, contextKey));
        const rightEntry = entryByKey.get(getResultAnalysisDisplayCellKey(rightKey, contextKey));
        if (!leftEntry || !rightEntry) continue;

        comparedContextKeys.push(contextKey);
        leftScores.push(leftEntry.score);
        rightScores.push(rightEntry.score);
        if (leftEntry.score === rightEntry.score) {
          ties += 1;
        } else if (inferredLowerBetter ? leftEntry.score < rightEntry.score : leftEntry.score > rightEntry.score) {
          leftWins += 1;
        } else {
          rightWins += 1;
        }
      }

      if (comparedContextKeys.length === 0) continue;
      pairs.push({
        leftKey,
        rightKey,
        sharedContextCount: comparedContextKeys.length,
        leftWins,
        rightWins,
        ties,
        comparedContextKeys,
        leftScoreMean: getResultAnalysisMeanScore(leftScores),
        rightScoreMean: getResultAnalysisMeanScore(rightScores),
      });
    }
  }

  return {
    view,
    scoreColumn,
    candidateField,
    contextField,
    lowerBetter: inferredLowerBetter,
    candidateKeys: sortedCandidateKeys,
    contextKeys: sortedContextKeys,
    entries,
    entryByKey,
    pairs,
  };
}
