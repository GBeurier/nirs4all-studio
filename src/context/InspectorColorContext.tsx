/**
 * InspectorColorContext — Chain-level color assignment for Inspector.
 *
 * Provides getChainColor() and getChainOpacity() functions used by all panels.
 * Supports modes: group, score (continuous), dataset, model_class (categorical).
 * Reuses palette definitions from lib/playground/colorConfig.ts.
 */

import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useInspectorData } from './InspectorDataContext';
import { useInspectorSelection, useInspectorHover } from './InspectorSelectionContext';
import {
  CONTINUOUS_PALETTES,
  CATEGORICAL_PALETTES,
  type ContinuousPalette,
  type CategoricalPalette,
} from '@/lib/playground/colorConfig';
import type {
  InspectorColorMode,
  InspectorColorConfig,
  InspectorChainSummary,
} from '@/types/inspector';
import { DEFAULT_INSPECTOR_COLOR_CONFIG } from '@/types/inspector';

// ============= Types =============

export interface InspectorColorContextValue {
  config: InspectorColorConfig;
  setMode: (mode: InspectorColorMode) => void;
  setContinuousPalette: (palette: ContinuousPalette) => void;
  setCategoricalPalette: (palette: CategoricalPalette) => void;
  setUnselectedOpacity: (opacity: number) => void;
  resetConfig: () => void;

  getChainColor: (chainId: string) => string;
  getChainOpacity: (chainId: string) => number;
}

// ============= Constants =============

const FALLBACK_COLOR = '#64748b'; // slate-500
const SESSION_KEY = 'inspector-color-config';

// ============= Helpers =============

function loadConfigFromStorage(): InspectorColorConfig {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) return { ...DEFAULT_INSPECTOR_COLOR_CONFIG, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_INSPECTOR_COLOR_CONFIG };
}

function saveConfigToStorage(config: InspectorColorConfig) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(config));
  } catch { /* ignore */ }
}

function normalizeValue(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

// ============= Context =============

const InspectorColorContext = createContext<InspectorColorContextValue | null>(null);

// ============= Provider =============

export function InspectorColorProvider({ children }: { children: ReactNode }) {
  const { chains, getChainGroup, scoreColumn, availableDatasets, availableModels } = useInspectorData();
  const { selectedChains, hasSelection } = useInspectorSelection();
  const { hoveredChain } = useInspectorHover();

  const [config, setConfig] = useState<InspectorColorConfig>(loadConfigFromStorage);

  // Build chain lookup map
  const chainMap = useMemo(() => {
    const map = new Map<string, InspectorChainSummary>();
    for (const c of chains as InspectorChainSummary[]) {
      map.set(c.chain_id, c);
    }
    return map;
  }, [chains]);

  // Score stats for gradient normalization
  const scoreStats = useMemo(() => {
    const scores: number[] = [];
    for (const c of chains as InspectorChainSummary[]) {
      const val = c[scoreColumn];
      if (val != null) scores.push(val);
    }
    if (scores.length === 0) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const s of scores) {
      if (s < min) min = s;
      if (s > max) max = s;
    }
    return { min, max };
  }, [chains, scoreColumn]);

  // Setters with persistence
  const setMode = useCallback((mode: InspectorColorMode) => {
    setConfig(prev => {
      const next = { ...prev, mode };
      saveConfigToStorage(next);
      return next;
    });
  }, []);

  const setContinuousPalette = useCallback((palette: ContinuousPalette) => {
    setConfig(prev => {
      const next = { ...prev, continuousPalette: palette };
      saveConfigToStorage(next);
      return next;
    });
  }, []);

  const setCategoricalPalette = useCallback((palette: CategoricalPalette) => {
    setConfig(prev => {
      const next = { ...prev, categoricalPalette: palette };
      saveConfigToStorage(next);
      return next;
    });
  }, []);

  const setUnselectedOpacity = useCallback((opacity: number) => {
    setConfig(prev => {
      const next = { ...prev, unselectedOpacity: opacity };
      saveConfigToStorage(next);
      return next;
    });
  }, []);

  const resetConfig = useCallback(() => {
    const defaults = { ...DEFAULT_INSPECTOR_COLOR_CONFIG };
    setConfig(defaults);
    saveConfigToStorage(defaults);
  }, []);

  // Core color function
  const getChainColor = useCallback((chainId: string): string => {
    const chain = chainMap.get(chainId);
    if (!chain) return FALLBACK_COLOR;

    switch (config.mode) {
      case 'group': {
        const group = getChainGroup(chainId);
        return group?.color ?? FALLBACK_COLOR;
      }
      case 'score': {
        const score = chain[scoreColumn];
        if (score == null || !scoreStats) return FALLBACK_COLOR;
        const t = normalizeValue(score, scoreStats.min, scoreStats.max);
        const paletteFn = CONTINUOUS_PALETTES[config.continuousPalette];
        return paletteFn ? paletteFn(t) : FALLBACK_COLOR;
      }
      case 'dataset': {
        const ds = chain.dataset_name ?? '(unknown)';
        const dsIndex = availableDatasets.indexOf(ds);
        const palette = CATEGORICAL_PALETTES[config.categoricalPalette];
        return palette ? palette[(dsIndex >= 0 ? dsIndex : 0) % palette.length] : FALLBACK_COLOR;
      }
      case 'model_class': {
        const mc = chain.model_class;
        const mcIndex = availableModels.indexOf(mc);
        const palette = CATEGORICAL_PALETTES[config.categoricalPalette];
        return palette ? palette[(mcIndex >= 0 ? mcIndex : 0) % palette.length] : FALLBACK_COLOR;
      }
      default:
        return FALLBACK_COLOR;
    }
  }, [chainMap, config.mode, config.continuousPalette, config.categoricalPalette, scoreColumn, scoreStats, getChainGroup, availableDatasets, availableModels]);

  // Core opacity function
  const getChainOpacity = useCallback((chainId: string): number => {
    if (config.highlightHover && hoveredChain === chainId) return 1;
    if (hasSelection && config.highlightSelection) {
      return selectedChains.has(chainId) ? 1 : config.unselectedOpacity;
    }
    return 0.7;
  }, [config.highlightHover, config.highlightSelection, config.unselectedOpacity, hoveredChain, hasSelection, selectedChains]);

  const value = useMemo<InspectorColorContextValue>(() => ({
    config,
    setMode,
    setContinuousPalette,
    setCategoricalPalette,
    setUnselectedOpacity,
    resetConfig,
    getChainColor,
    getChainOpacity,
  }), [
    config, setMode, setContinuousPalette, setCategoricalPalette,
    setUnselectedOpacity, resetConfig, getChainColor, getChainOpacity,
  ]);

  return (
    <InspectorColorContext.Provider value={value}>
      {children}
    </InspectorColorContext.Provider>
  );
}

// ============= Hook =============

export function useInspectorColor(): InspectorColorContextValue {
  const context = useContext(InspectorColorContext);
  if (!context) {
    throw new Error('useInspectorColor must be used within an InspectorColorProvider');
  }
  return context;
}
