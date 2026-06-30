import type {
  ExpressionCombinator,
  ExpressionRule,
  GroupByExpressionConfig,
  GroupByRangeConfig,
  GroupByTopKConfig,
  GroupByVariable,
  GroupMode,
  InspectorChainSummary,
  InspectorGroup,
} from "@/types/inspector";
import { INSPECTOR_GROUP_COLORS } from "@/types/inspector";
import {
  compareInspectorScoreValues,
  getInspectorFiniteScore,
} from "@/lib/inspector/scoreAccess";
import {
  getResultAnalysisChains,
  type ResultAnalysisStore,
} from "@/lib/inspector/resultAnalysisStore";

export interface InspectorGroupingConfig {
  groupMode: GroupMode;
  groupBy: GroupByVariable | null;
  rangeConfig: GroupByRangeConfig | null;
  topKConfig: GroupByTopKConfig | null;
  expressionConfig: GroupByExpressionConfig | null;
}

export function computeInspectorGroups(
  chains: readonly InspectorChainSummary[],
  {
    groupMode,
    groupBy,
    rangeConfig,
    topKConfig,
    expressionConfig,
  }: InspectorGroupingConfig,
): InspectorGroup[] {
  switch (groupMode) {
    case "by_variable":
      return computeGroupsByVariable(chains, groupBy);
    case "by_range":
      return computeGroupsByRange(chains, rangeConfig);
    case "by_top_k":
      return computeGroupsByTopK(chains, topKConfig);
    case "by_branch":
      return computeGroupsByBranch(chains);
    case "by_expression":
      return computeGroupsByExpression(chains, expressionConfig);
    default:
      return [];
  }
}

export function computeInspectorGroupsFromStore(
  store: Pick<ResultAnalysisStore, "chains">,
  config: InspectorGroupingConfig,
): InspectorGroup[] {
  return computeInspectorGroups(getResultAnalysisChains(store), config);
}

export function buildInspectorChainGroupMap(
  groups: readonly InspectorGroup[],
): Map<string, InspectorGroup> {
  const map = new Map<string, InspectorGroup>();
  for (const group of groups) {
    for (const chainId of group.chain_ids) {
      map.set(chainId, group);
    }
  }
  return map;
}

function computeGroupsByVariable(
  chains: readonly InspectorChainSummary[],
  groupBy: GroupByVariable | null,
): InspectorGroup[] {
  if (!groupBy || chains.length === 0) return [];

  const buckets = new Map<string, string[]>();
  for (const chain of chains) {
    const rawValue = chain[groupBy];
    const value = rawValue != null ? String(rawValue) : "(empty)";
    if (!buckets.has(value)) buckets.set(value, []);
    buckets.get(value)!.push(chain.chain_id);
  }

  const groups: InspectorGroup[] = [];
  let colorIndex = 0;
  for (const [label, chainIds] of buckets) {
    groups.push({
      id: `group-${groupBy}-${label}`,
      label,
      color: INSPECTOR_GROUP_COLORS[colorIndex % INSPECTOR_GROUP_COLORS.length],
      chain_ids: chainIds,
    });
    colorIndex++;
  }

  groups.sort((a, b) => b.chain_ids.length - a.chain_ids.length);
  return groups;
}

function computeGroupsByRange(
  chains: readonly InspectorChainSummary[],
  config: GroupByRangeConfig | null,
): InspectorGroup[] {
  if (!config || chains.length === 0) return [];

  const scores: number[] = [];
  for (const chain of chains) {
    const value = getInspectorFiniteScore(chain, config.column);
    if (value != null) scores.push(value);
  }
  if (scores.length === 0) return [];

  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const binCount = Math.max(2, config.binCount);
  const binWidth = (max - min) / binCount;

  const groups: InspectorGroup[] = [];
  for (let index = 0; index < binCount; index++) {
    const binMin = min + index * binWidth;
    const binMax = index === binCount - 1 ? max + 0.001 : min + (index + 1) * binWidth;
    const label = `${binMin.toFixed(3)} – ${(index === binCount - 1 ? max : binMax).toFixed(3)}`;
    const matchingIds = chains
      .filter((chain) => {
        const value = getInspectorFiniteScore(chain, config.column);
        return value != null && value >= binMin && value < binMax;
      })
      .map((chain) => chain.chain_id);

    if (matchingIds.length > 0) {
      groups.push({
        id: `group-range-${index}`,
        label,
        color: INSPECTOR_GROUP_COLORS[index % INSPECTOR_GROUP_COLORS.length],
        chain_ids: matchingIds,
      });
    }
  }
  return groups;
}

function computeGroupsByTopK(
  chains: readonly InspectorChainSummary[],
  config: GroupByTopKConfig | null,
): InspectorGroup[] {
  if (!config || chains.length === 0) return [];

  const sorted = [...chains]
    .filter((chain) => getInspectorFiniteScore(chain, config.scoreColumn) != null)
    .sort((left, right) => {
      const leftValue = getInspectorFiniteScore(left, config.scoreColumn) ?? 0;
      const rightValue = getInspectorFiniteScore(right, config.scoreColumn) ?? 0;
      return compareInspectorScoreValues(leftValue, rightValue, config.ascending ?? false);
    });

  const topK = sorted.slice(0, config.k);
  const rest = sorted.slice(config.k);

  const groups: InspectorGroup[] = [
    {
      id: "group-top-k",
      label: `Top ${config.k}`,
      color: INSPECTOR_GROUP_COLORS[0],
      chain_ids: topK.map((chain) => chain.chain_id),
    },
  ];

  if (rest.length > 0) {
    groups.push({
      id: "group-rest",
      label: `Others (${rest.length})`,
      color: INSPECTOR_GROUP_COLORS[1],
      chain_ids: rest.map((chain) => chain.chain_id),
    });
  }
  return groups;
}

function computeGroupsByBranch(chains: readonly InspectorChainSummary[]): InspectorGroup[] {
  if (chains.length === 0) return [];

  const buckets = new Map<string, string[]>();
  for (const chain of chains) {
    const label = chain.branch_path != null ? String(chain.branch_path) : "(no branch)";
    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label)!.push(chain.chain_id);
  }

  const groups: InspectorGroup[] = [];
  let index = 0;
  for (const [label, chainIds] of buckets) {
    groups.push({
      id: `group-branch-${label}`,
      label,
      color: INSPECTOR_GROUP_COLORS[index % INSPECTOR_GROUP_COLORS.length],
      chain_ids: chainIds,
    });
    index++;
  }
  groups.sort((a, b) => b.chain_ids.length - a.chain_ids.length);
  return groups;
}

function computeGroupsByExpression(
  chains: readonly InspectorChainSummary[],
  config: GroupByExpressionConfig | null,
): InspectorGroup[] {
  if (!config || config.groups.length === 0 || chains.length === 0) return [];

  const groups: InspectorGroup[] = [];
  for (let index = 0; index < config.groups.length; index++) {
    const exprGroup = config.groups[index];
    if (exprGroup.rules.length === 0) continue;
    const matchingIds = chains
      .filter((chain) => evaluateRules(chain, exprGroup.rules, exprGroup.combinator))
      .map((chain) => chain.chain_id);

    groups.push({
      id: `group-expr-${exprGroup.id}`,
      label: exprGroup.label || `Group ${index + 1}`,
      color: INSPECTOR_GROUP_COLORS[index % INSPECTOR_GROUP_COLORS.length],
      chain_ids: matchingIds,
    });
  }
  return groups;
}

function evaluateRules(
  chain: InspectorChainSummary,
  rules: ExpressionRule[],
  combinator: ExpressionCombinator,
): boolean {
  if (rules.length === 0) return false;
  if (combinator === "AND") {
    return rules.every((rule) => evaluateRule(chain, rule));
  }
  return rules.some((rule) => evaluateRule(chain, rule));
}

function evaluateRule(chain: InspectorChainSummary, rule: ExpressionRule): boolean {
  const rawValue = chain[rule.field];
  const strValue = rawValue != null ? String(rawValue) : "";
  const numValue = typeof rawValue === "number" ? rawValue : parseFloat(strValue);
  const ruleNum = parseFloat(rule.value);

  switch (rule.operator) {
    case "eq":
      return strValue === rule.value;
    case "neq":
      return strValue !== rule.value;
    case "contains":
      return strValue.toLowerCase().includes(rule.value.toLowerCase());
    case "not_contains":
      return !strValue.toLowerCase().includes(rule.value.toLowerCase());
    case "gt":
      return !Number.isNaN(numValue) && !Number.isNaN(ruleNum) && numValue > ruleNum;
    case "lt":
      return !Number.isNaN(numValue) && !Number.isNaN(ruleNum) && numValue < ruleNum;
    case "gte":
      return !Number.isNaN(numValue) && !Number.isNaN(ruleNum) && numValue >= ruleNum;
    case "lte":
      return !Number.isNaN(numValue) && !Number.isNaN(ruleNum) && numValue <= ruleNum;
    default:
      return false;
  }
}
