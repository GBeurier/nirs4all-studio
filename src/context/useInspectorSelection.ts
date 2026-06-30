import { createContext, useContext } from 'react';
import type { InspectorSelectionToolMode } from '@/types/inspector';
import type {
  InspectorSelectionMode,
  InspectorSelectionState,
} from '@/lib/inspector/selectionState';

export type { InspectorSelectionMode, InspectorSelectionState };

export interface InspectorSelectionContextValue extends InspectorSelectionState {
  // Selection
  select: (chainIds: string[], mode?: InspectorSelectionMode) => void;
  deselect: (chainIds: string[]) => void;
  toggle: (chainIds: string[]) => void;
  clear: () => void;
  selectAll: (chainIds: string[]) => void;
  invert: (allChainIds: string[]) => void;
  undo: () => void;
  redo: () => void;
  setSelectionMode: (mode: InspectorSelectionMode) => void;
  isSelected: (chainId: string) => boolean;
  selectedCount: number;
  hasSelection: boolean;
  canUndo: boolean;
  canRedo: boolean;

  // Pins
  pin: (chainIds: string[]) => void;
  unpin: (chainIds: string[]) => void;
  clearPins: () => void;
  togglePin: (chainId: string) => void;
  isPinned: (chainId: string) => boolean;
  pinnedCount: number;

  // Saved selections
  saveSelection: (name: string, color?: string) => void;
  loadSelection: (id: string) => void;
  deleteSavedSelection: (id: string) => void;

  // Tool mode
  setSelectionToolMode: (tool: InspectorSelectionToolMode) => void;
}

export interface InspectorHoverContextValue {
  hoveredChain: string | null;
  setHovered: (chainId: string | null) => void;
}

export const InspectorSelectionContext = createContext<InspectorSelectionContextValue | undefined>(undefined);
export const InspectorHoverContext = createContext<InspectorHoverContextValue | undefined>(undefined);

export function useInspectorSelection(): InspectorSelectionContextValue {
  const context = useContext(InspectorSelectionContext);
  if (context === undefined) {
    throw new Error('useInspectorSelection must be used within an InspectorSelectionProvider');
  }
  return context;
}

export function useInspectorHover(): InspectorHoverContextValue {
  const context = useContext(InspectorHoverContext);
  if (context === undefined) {
    throw new Error('useInspectorHover must be used within an InspectorSelectionProvider');
  }
  return context;
}
