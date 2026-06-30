import { createContext, useContext } from 'react';
import type { InspectorPanelType, InspectorViewState } from '@/types/inspector';
import type {
  InspectorLayoutMode,
  InspectorViewStateValue,
} from '@/lib/inspector/viewState';

export type LayoutMode = InspectorLayoutMode;
export type { InspectorViewStateValue };

export interface InspectorViewContextValue extends InspectorViewStateValue {
  setPanelState: (panel: InspectorPanelType, state: InspectorViewState) => void;
  togglePanel: (panel: InspectorPanelType) => void;
  isPanelVisible: (panel: InspectorPanelType) => boolean;
  isPanelMinimized: (panel: InspectorPanelType) => boolean;
  maximizePanel: (panel: InspectorPanelType | null) => void;
  minimizePanel: (panel: InspectorPanelType) => void;
  restorePanel: (panel: InspectorPanelType) => void;
  toggleMaximize: (panel: InspectorPanelType) => void;
  setFocusedPanel: (panel: InspectorPanelType | null) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  showAll: () => void;
  resetView: () => void;
  visiblePanels: Set<InspectorPanelType>;
  visibleCount: number;
  hasMaximized: boolean;
}

export { INSPECTOR_ALL_PANELS as ALL_PANELS } from '@/lib/inspector/viewState';

export const InspectorViewContext = createContext<InspectorViewContextValue | null>(null);

export function useInspectorView(): InspectorViewContextValue {
  const context = useContext(InspectorViewContext);
  if (!context) {
    throw new Error('useInspectorView must be used within an InspectorViewProvider');
  }
  return context;
}
