import { useMemo, useRef } from 'react';

import { ALL_PANELS, useInspectorView } from '@/context/useInspectorView';
import type { InspectorPanelType } from '@/types/inspector';

export interface InspectorPanelActions {
  onMaximize: () => void;
  onMinimize: () => void;
  onRestore: () => void;
  onHide: () => void;
}

export function useInspectorPanelActions(): Record<InspectorPanelType, InspectorPanelActions> {
  const view = useInspectorView();
  const viewActionsRef = useRef({
    minimizePanel: view.minimizePanel,
    restorePanel: view.restorePanel,
    toggleMaximize: view.toggleMaximize,
    togglePanel: view.togglePanel,
  });

  viewActionsRef.current = {
    minimizePanel: view.minimizePanel,
    restorePanel: view.restorePanel,
    toggleMaximize: view.toggleMaximize,
    togglePanel: view.togglePanel,
  };

  return useMemo(() => {
    return ALL_PANELS.reduce((actions, panelType) => {
      actions[panelType] = {
        onMaximize: () => viewActionsRef.current.toggleMaximize(panelType),
        onMinimize: () => viewActionsRef.current.minimizePanel(panelType),
        onRestore: () => viewActionsRef.current.restorePanel(panelType),
        onHide: () => viewActionsRef.current.togglePanel(panelType),
      };
      return actions;
    }, {} as Record<InspectorPanelType, InspectorPanelActions>);
  }, []);
}
