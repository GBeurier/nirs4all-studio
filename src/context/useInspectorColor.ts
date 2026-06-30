import { createContext, useContext } from 'react';
import type {
  CategoricalPalette,
  ContinuousPalette,
} from '@/lib/playground/colorConfig';
import type {
  InspectorColorConfig,
  InspectorColorMode,
} from '@/types/inspector';

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

export const InspectorColorContext = createContext<InspectorColorContextValue | null>(null);

export function useInspectorColor(): InspectorColorContextValue {
  const context = useContext(InspectorColorContext);
  if (!context) {
    throw new Error('useInspectorColor must be used within an InspectorColorProvider');
  }
  return context;
}

export type {
  CategoricalPalette,
  ContinuousPalette,
  InspectorColorConfig,
  InspectorColorMode,
};
