import {
  CATEGORICAL_PALETTES,
  CONTINUOUS_PALETTES,
} from "@/lib/playground/colorConfig";
import { getInspectorFiniteScore } from "@/lib/inspector/scoreAccess";
import type { ResultAnalysisStore } from "@/lib/inspector/resultAnalysisStore";
import type {
  CategoricalPalette,
  ContinuousPalette,
} from "@/lib/playground/colorConfig";
import type {
  InspectorColorConfig,
  InspectorGroup,
  ScoreColumn,
} from "@/types/inspector";

export const INSPECTOR_FALLBACK_COLOR = "#64748b";
export const INSPECTOR_DEFAULT_OPACITY = 0.7;

export interface InspectorColorScoreRange {
  min: number;
  max: number;
}

export interface InspectorColorResolverInput {
  store: Pick<ResultAnalysisStore, "chainById" | "chains">;
  chainId: string;
  config: Pick<InspectorColorConfig, "mode" | "continuousPalette" | "categoricalPalette">;
  scoreColumn: ScoreColumn;
  scoreRange: InspectorColorScoreRange | null;
  getChainGroup: (chainId: string) => InspectorGroup | undefined;
  availableDatasets: readonly string[];
  availableModels: readonly string[];
}

export interface InspectorOpacityResolverInput {
  chainId: string;
  hoveredChain: string | null;
  hasSelection: boolean;
  selectedChainIds: ReadonlySet<string>;
  unselectedOpacity: number;
}

function normalizeValue(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function pickCategoricalColor(
  value: string,
  availableValues: readonly string[],
  paletteName: CategoricalPalette,
): string {
  const palette = CATEGORICAL_PALETTES[paletteName];
  if (!palette) return INSPECTOR_FALLBACK_COLOR;

  const index = availableValues.indexOf(value);
  return palette[(index >= 0 ? index : 0) % palette.length] ?? INSPECTOR_FALLBACK_COLOR;
}

export function computeInspectorColorScoreRange(
  store: Pick<ResultAnalysisStore, "chains">,
  scoreColumn: ScoreColumn,
): InspectorColorScoreRange | null {
  const scores = store.chains
    .map(chain => getInspectorFiniteScore(chain, scoreColumn))
    .filter((score): score is number => score != null);

  if (scores.length === 0) return null;

  return {
    min: Math.min(...scores),
    max: Math.max(...scores),
  };
}

export function resolveInspectorChainColor({
  store,
  chainId,
  config,
  scoreColumn,
  scoreRange,
  getChainGroup,
  availableDatasets,
  availableModels,
}: InspectorColorResolverInput): string {
  const chain = store.chainById.get(chainId);
  if (!chain) return INSPECTOR_FALLBACK_COLOR;

  switch (config.mode) {
    case "group": {
      return getChainGroup(chainId)?.color ?? INSPECTOR_FALLBACK_COLOR;
    }
    case "score": {
      const score = getInspectorFiniteScore(chain, scoreColumn);
      if (score == null || !scoreRange) return INSPECTOR_FALLBACK_COLOR;

      const palette = CONTINUOUS_PALETTES[config.continuousPalette as ContinuousPalette];
      return palette ? palette(normalizeValue(score, scoreRange.min, scoreRange.max)) : INSPECTOR_FALLBACK_COLOR;
    }
    case "dataset": {
      return pickCategoricalColor(
        chain.dataset_name ?? "(unknown)",
        availableDatasets,
        config.categoricalPalette,
      );
    }
    case "model_class": {
      return pickCategoricalColor(
        chain.model_class,
        availableModels,
        config.categoricalPalette,
      );
    }
    default:
      return INSPECTOR_FALLBACK_COLOR;
  }
}

export function resolveInspectorChainOpacity({
  chainId,
  hoveredChain,
  hasSelection,
  selectedChainIds,
  unselectedOpacity,
}: InspectorOpacityResolverInput): number {
  if (hoveredChain === chainId) return 1;
  if (hasSelection) return selectedChainIds.has(chainId) ? 1 : unselectedOpacity;
  return INSPECTOR_DEFAULT_OPACITY;
}
