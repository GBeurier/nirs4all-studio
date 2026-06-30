/**
 * InspectorColorContext — Chain-level color assignment for Inspector.
 *
 * Provides getChainColor() and getChainOpacity() functions used by all panels.
 * Supports modes: group, score (continuous), dataset, model_class (categorical).
 * Reuses palette definitions from lib/playground/colorConfig.ts.
 */

import {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useInspectorData } from './useInspectorDataContext';
import { useInspectorSelection, useInspectorHover } from './useInspectorSelection';
import {
  type ContinuousPalette,
  type CategoricalPalette,
} from '@/lib/playground/colorConfig';
import {
  clientStorageKeys,
  readClientStorageJson,
  writeClientStorageJson,
} from '@/lib/clientStorage';
import { DEFAULT_INSPECTOR_COLOR_CONFIG } from '@/types/inspector';
import {
  computeInspectorColorScoreRange,
  resolveInspectorChainColor,
  resolveInspectorChainOpacity,
} from '@/lib/inspector/coloring';
import { buildResultAnalysisStore } from '@/lib/inspector/resultAnalysisStore';
import {
  InspectorColorContext,
  type InspectorColorConfig,
  type InspectorColorContextValue,
  type InspectorColorMode,
} from '@/context/useInspectorColor';

// ============= Helpers =============

function loadConfigFromStorage(): InspectorColorConfig {
  const parsed = readClientStorageJson<Partial<InspectorColorConfig>>(clientStorageKeys.inspectorColorConfig);
  if (parsed) return { ...DEFAULT_INSPECTOR_COLOR_CONFIG, ...parsed };
  return { ...DEFAULT_INSPECTOR_COLOR_CONFIG };
}

function saveConfigToStorage(config: InspectorColorConfig) {
  writeClientStorageJson(clientStorageKeys.inspectorColorConfig, config);
}

// ============= Provider =============

export function InspectorColorProvider({ children }: { children: ReactNode }) {
  const { chains, getChainGroup, scoreColumn, availableDatasets, availableModels } = useInspectorData();
  const { selectedChains, hasSelection } = useInspectorSelection();
  const { hoveredChain } = useInspectorHover();

  const [config, setConfig] = useState<InspectorColorConfig>(loadConfigFromStorage);

  const analysisStore = useMemo(
    () => buildResultAnalysisStore({ chains }),
    [chains],
  );

  // Score stats for gradient normalization
  const scoreRange = useMemo(
    () => computeInspectorColorScoreRange(analysisStore, scoreColumn),
    [analysisStore, scoreColumn],
  );

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
    return resolveInspectorChainColor({
      store: analysisStore,
      chainId,
      config,
      scoreColumn,
      scoreRange,
      getChainGroup,
      availableDatasets,
      availableModels,
    });
  }, [analysisStore, config, scoreColumn, scoreRange, getChainGroup, availableDatasets, availableModels]);

  // Core opacity function
  const getChainOpacity = useCallback((chainId: string): number => {
    return resolveInspectorChainOpacity({
      chainId,
      hoveredChain,
      hasSelection,
      selectedChainIds: selectedChains,
      unselectedOpacity: config.unselectedOpacity,
    });
  }, [config.unselectedOpacity, hoveredChain, hasSelection, selectedChains]);

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
