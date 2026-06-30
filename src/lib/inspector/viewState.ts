import type { InspectorPanelType, InspectorViewState } from '@/types/inspector';

export type InspectorLayoutMode = 'auto' | 'grid-2' | 'grid-3' | 'single-column';

export interface InspectorViewStateValue {
  panelStates: Record<InspectorPanelType, InspectorViewState>;
  maximizedPanel: InspectorPanelType | null;
  focusedPanel: InspectorPanelType | null;
  layoutMode: InspectorLayoutMode;
}

export type InspectorViewAction =
  | { type: 'SET_PANEL_STATE'; panel: InspectorPanelType; state: InspectorViewState }
  | { type: 'TOGGLE_PANEL'; panel: InspectorPanelType }
  | { type: 'MAXIMIZE_PANEL'; panel: InspectorPanelType | null }
  | { type: 'MINIMIZE_PANEL'; panel: InspectorPanelType }
  | { type: 'RESTORE_PANEL'; panel: InspectorPanelType }
  | { type: 'SET_FOCUSED_PANEL'; panel: InspectorPanelType | null }
  | { type: 'SET_LAYOUT_MODE'; mode: InspectorLayoutMode }
  | { type: 'SHOW_ALL' }
  | { type: 'RESET' };

export interface InspectorViewSessionSnapshot {
  panelStates?: Record<string, unknown> | null;
  layoutMode?: unknown;
}

export const INSPECTOR_ALL_PANELS: InspectorPanelType[] = [
  'scatter',
  'residuals',
  'rankings',
  'heatmap',
  'histogram',
  'candlestick',
  'branch_comparison',
  'branch_topology',
  'fold_stability',
  'confusion',
  'preprocessing_impact',
  'hyperparameter',
  'bias_variance',
];

export const INSPECTOR_DEFAULT_VISIBLE_PANELS: readonly InspectorPanelType[] = [
  'rankings',
  'heatmap',
  'histogram',
  'candlestick',
  'scatter',
  'preprocessing_impact',
];

const INSPECTOR_PANEL_SET = new Set<InspectorPanelType>(INSPECTOR_ALL_PANELS);
const INSPECTOR_VIEW_STATES = new Set<InspectorViewState>(['visible', 'hidden', 'maximized', 'minimized']);
const INSPECTOR_LAYOUT_MODES = new Set<InspectorLayoutMode>(['auto', 'grid-2', 'grid-3', 'single-column']);
const INSPECTOR_DEFAULT_VISIBLE_PANEL_SET = new Set<InspectorPanelType>(INSPECTOR_DEFAULT_VISIBLE_PANELS);

function isInspectorPanelType(value: string): value is InspectorPanelType {
  return INSPECTOR_PANEL_SET.has(value as InspectorPanelType);
}

function isInspectorViewState(value: unknown): value is InspectorViewState {
  return typeof value === 'string' && INSPECTOR_VIEW_STATES.has(value as InspectorViewState);
}

function isInspectorLayoutMode(value: unknown): value is InspectorLayoutMode {
  return typeof value === 'string' && INSPECTOR_LAYOUT_MODES.has(value as InspectorLayoutMode);
}

function restoreMaximizedPanel(
  panelStates: Record<InspectorPanelType, InspectorViewState>,
): InspectorPanelType | null {
  for (const panel of INSPECTOR_ALL_PANELS) {
    if (panelStates[panel] === 'maximized') {
      return panel;
    }
  }
  return null;
}

function demoteMaximizedPanels(
  panelStates: Record<InspectorPanelType, InspectorViewState>,
): Record<InspectorPanelType, InspectorViewState> {
  const next = { ...panelStates };
  for (const panel of INSPECTOR_ALL_PANELS) {
    if (next[panel] === 'maximized') {
      next[panel] = 'visible';
    }
  }
  return next;
}

export function createInitialInspectorViewState(): InspectorViewStateValue {
  const panelStates = {} as Record<InspectorPanelType, InspectorViewState>;
  for (const panel of INSPECTOR_ALL_PANELS) {
    panelStates[panel] = INSPECTOR_DEFAULT_VISIBLE_PANEL_SET.has(panel) ? 'visible' : 'hidden';
  }
  return {
    panelStates,
    maximizedPanel: null,
    focusedPanel: null,
    layoutMode: 'auto',
  };
}

export function restoreInspectorViewState(
  snapshot: InspectorViewSessionSnapshot | null | undefined,
): InspectorViewStateValue {
  const initial = createInitialInspectorViewState();
  if (!snapshot?.panelStates) {
    return initial;
  }

  const panelStates = { ...initial.panelStates };
  for (const [key, value] of Object.entries(snapshot.panelStates)) {
    if (isInspectorPanelType(key) && isInspectorViewState(value)) {
      panelStates[key] = value;
    }
  }

  return {
    ...initial,
    panelStates,
    maximizedPanel: restoreMaximizedPanel(panelStates),
    layoutMode: isInspectorLayoutMode(snapshot.layoutMode) ? snapshot.layoutMode : initial.layoutMode,
  };
}

export function isInspectorPanelVisible(
  panelStates: Record<InspectorPanelType, InspectorViewState>,
  panel: InspectorPanelType,
): boolean {
  const state = panelStates[panel];
  return state === 'visible' || state === 'maximized';
}

export function isInspectorPanelMinimized(
  panelStates: Record<InspectorPanelType, InspectorViewState>,
  panel: InspectorPanelType,
): boolean {
  return panelStates[panel] === 'minimized';
}

export function getInspectorVisiblePanels(
  panelStates: Record<InspectorPanelType, InspectorViewState>,
): Set<InspectorPanelType> {
  const visible = new Set<InspectorPanelType>();
  for (const panel of INSPECTOR_ALL_PANELS) {
    const state = panelStates[panel];
    if (state === 'visible' || state === 'maximized' || state === 'minimized') {
      visible.add(panel);
    }
  }
  return visible;
}

export function getInspectorVisiblePanelCount(
  panelStates: Record<InspectorPanelType, InspectorViewState>,
): number {
  let count = 0;
  for (const panel of INSPECTOR_ALL_PANELS) {
    if (isInspectorPanelVisible(panelStates, panel)) {
      count += 1;
    }
  }
  return count;
}

export function inspectorViewReducer(
  state: InspectorViewStateValue,
  action: InspectorViewAction,
): InspectorViewStateValue {
  switch (action.type) {
    case 'SET_PANEL_STATE': {
      if (action.state === 'maximized') {
        const panelStates = demoteMaximizedPanels(state.panelStates);
        panelStates[action.panel] = 'maximized';
        return { ...state, panelStates, maximizedPanel: action.panel };
      }
      return {
        ...state,
        panelStates: { ...state.panelStates, [action.panel]: action.state },
        maximizedPanel: state.maximizedPanel === action.panel ? null : state.maximizedPanel,
      };
    }

    case 'TOGGLE_PANEL': {
      const current = state.panelStates[action.panel];
      const nextState: InspectorViewState = current === 'hidden' ? 'visible' : 'hidden';
      return {
        ...state,
        panelStates: { ...state.panelStates, [action.panel]: nextState },
        maximizedPanel: nextState === 'hidden' && state.maximizedPanel === action.panel ? null : state.maximizedPanel,
      };
    }

    case 'MAXIMIZE_PANEL': {
      const panelStates = demoteMaximizedPanels(state.panelStates);
      if (action.panel === null) {
        return { ...state, panelStates, maximizedPanel: null };
      }
      panelStates[action.panel] = 'maximized';
      return { ...state, panelStates, maximizedPanel: action.panel };
    }

    case 'MINIMIZE_PANEL':
      return {
        ...state,
        panelStates: { ...state.panelStates, [action.panel]: 'minimized' },
        maximizedPanel: state.maximizedPanel === action.panel ? null : state.maximizedPanel,
      };

    case 'RESTORE_PANEL': {
      const current = state.panelStates[action.panel];
      if (current !== 'minimized' && current !== 'maximized') {
        return state;
      }
      return {
        ...state,
        panelStates: { ...state.panelStates, [action.panel]: 'visible' },
        maximizedPanel: state.maximizedPanel === action.panel ? null : state.maximizedPanel,
      };
    }

    case 'SET_FOCUSED_PANEL':
      return { ...state, focusedPanel: action.panel };

    case 'SET_LAYOUT_MODE':
      return { ...state, layoutMode: action.mode };

    case 'SHOW_ALL': {
      const panelStates = {} as Record<InspectorPanelType, InspectorViewState>;
      for (const panel of INSPECTOR_ALL_PANELS) {
        panelStates[panel] = 'visible';
      }
      return { ...state, panelStates, maximizedPanel: null };
    }

    case 'RESET':
      return createInitialInspectorViewState();

    default:
      return state;
  }
}
