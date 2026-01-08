/**
 * usePlaygroundShortcuts - Centralized keyboard shortcuts system
 *
 * Features:
 * - Centralized shortcut registry
 * - Conflict detection
 * - Help overlay trigger (? key)
 * - Customizable shortcuts (future)
 * - Context-aware shortcuts (disabled in input fields)
 *
 * Phase 6: Performance & Polish
 */

import { useEffect, useCallback, useMemo, useState } from 'react';
import { useSelection } from '@/context/SelectionContext';

// ============= Types =============

export interface KeyboardShortcut {
  /** Unique identifier */
  id: string;
  /** Display label */
  label: string;
  /** Description of the action */
  description: string;
  /** Key combination (e.g., 'Ctrl+S', 'Escape', '1') */
  keys: string;
  /** Category for grouping in help */
  category: ShortcutCategory;
  /** Whether the shortcut is currently enabled */
  enabled?: boolean;
  /** Action handler */
  handler: () => void;
  /** Whether to prevent default browser behavior */
  preventDefault?: boolean;
}

export type ShortcutCategory =
  | 'selection'
  | 'navigation'
  | 'pipeline'
  | 'view'
  | 'export'
  | 'general';

export interface ShortcutRegistry {
  shortcuts: KeyboardShortcut[];
  conflicts: ShortcutConflict[];
}

export interface ShortcutConflict {
  keys: string;
  shortcutIds: string[];
}

export interface UsePlaygroundShortcutsOptions {
  /** Total number of samples for select-all */
  totalSamples?: number;
  /** Callbacks for various actions */
  onUndo?: () => void;
  onRedo?: () => void;
  onClearPipeline?: () => void;
  onSaveSelection?: () => void;
  onExportData?: () => void;
  onExportPng?: () => void;
  onToggleChart?: (index: number) => void;
  onShowHelp?: () => void;
  onRefresh?: () => void;
  /** Whether undo is available */
  canUndo?: boolean;
  /** Whether redo is available */
  canRedo?: boolean;
  /** Whether shortcuts are enabled */
  enabled?: boolean;
}

export interface UsePlaygroundShortcutsResult {
  /** All registered shortcuts */
  shortcuts: KeyboardShortcut[];
  /** Shortcuts grouped by category */
  shortcutsByCategory: Record<ShortcutCategory, KeyboardShortcut[]>;
  /** Any detected conflicts */
  conflicts: ShortcutConflict[];
  /** Whether help overlay should be shown */
  showHelp: boolean;
  /** Toggle help overlay */
  setShowHelp: (show: boolean) => void;
  /** Register a custom shortcut */
  registerShortcut: (shortcut: Omit<KeyboardShortcut, 'id'> & { id?: string }) => void;
  /** Unregister a shortcut */
  unregisterShortcut: (id: string) => void;
}

// ============= Helpers =============

/**
 * Normalize key combination string for comparison
 */
function normalizeKeys(keys: string): string {
  return keys
    .toLowerCase()
    .split('+')
    .map((k) => k.trim())
    .sort()
    .join('+');
}

/**
 * Parse keyboard event to key combination string
 */
function eventToKeys(e: KeyboardEvent): string {
  const parts: string[] = [];

  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');

  // Normalize key names
  let key = e.key.toLowerCase();
  if (key === ' ') key = 'space';
  if (key === 'escape') key = 'escape';
  if (key === 'backspace') key = 'backspace';
  if (key === 'delete') key = 'delete';
  if (key === 'arrowup') key = 'up';
  if (key === 'arrowdown') key = 'down';
  if (key === 'arrowleft') key = 'left';
  if (key === 'arrowright') key = 'right';

  // Don't add modifier keys as the main key
  if (!['control', 'shift', 'alt', 'meta'].includes(key)) {
    parts.push(key);
  }

  return parts.sort().join('+');
}

/**
 * Check if target element is an input field
 */
function isInputElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable ||
    target.closest('[contenteditable="true"]') !== null
  );
}

/**
 * Detect conflicts in shortcut registry
 */
function detectConflicts(shortcuts: KeyboardShortcut[]): ShortcutConflict[] {
  const conflicts: ShortcutConflict[] = [];
  const keyMap = new Map<string, string[]>();

  shortcuts.forEach((shortcut) => {
    if (shortcut.enabled === false) return;

    const normalized = normalizeKeys(shortcut.keys);
    const existing = keyMap.get(normalized) ?? [];
    existing.push(shortcut.id);
    keyMap.set(normalized, existing);
  });

  keyMap.forEach((ids, keys) => {
    if (ids.length > 1) {
      conflicts.push({ keys, shortcutIds: ids });
    }
  });

  return conflicts;
}

// ============= Category Display =============

export const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  selection: 'Selection',
  navigation: 'Navigation',
  pipeline: 'Pipeline',
  view: 'View',
  export: 'Export',
  general: 'General',
};

export const CATEGORY_ORDER: ShortcutCategory[] = [
  'general',
  'selection',
  'pipeline',
  'view',
  'export',
  'navigation',
];

// ============= Main Hook =============

export function usePlaygroundShortcuts(
  options: UsePlaygroundShortcutsOptions = {}
): UsePlaygroundShortcutsResult {
  const {
    totalSamples = 0,
    onUndo,
    onRedo,
    onClearPipeline,
    onSaveSelection,
    onExportData,
    onExportPng,
    onToggleChart,
    onShowHelp,
    onRefresh,
    canUndo = false,
    canRedo = false,
    enabled = true,
  } = options;

  const {
    selectAll,
    clear,
    invert,
    pin,
    clearPins,
    pinnedSamples,
    selectedSamples,
    undo: selectionUndo,
    redo: selectionRedo,
    canUndo: canUndoSelection,
    canRedo: canRedoSelection,
    selectedCount,
  } = useSelection();

  const [showHelp, setShowHelp] = useState(false);
  const [customShortcuts, setCustomShortcuts] = useState<KeyboardShortcut[]>([]);

  // Build default shortcuts
  const defaultShortcuts = useMemo<KeyboardShortcut[]>(
    () => [
      // General
      {
        id: 'help',
        label: 'Help',
        description: 'Show keyboard shortcuts',
        keys: '?',
        category: 'general',
        handler: () => {
          setShowHelp(true);
          onShowHelp?.();
        },
        preventDefault: true,
      },
      {
        id: 'refresh',
        label: 'Refresh',
        description: 'Refresh pipeline execution',
        keys: 'Ctrl+R',
        category: 'general',
        enabled: !!onRefresh,
        handler: () => onRefresh?.(),
        preventDefault: true,
      },

      // Selection
      {
        id: 'select-all',
        label: 'Select All',
        description: 'Select all samples',
        keys: 'Ctrl+A',
        category: 'selection',
        enabled: totalSamples > 0,
        handler: () => selectAll(totalSamples),
        preventDefault: true,
      },
      {
        id: 'clear-selection',
        label: 'Clear Selection',
        description: 'Clear current selection',
        keys: 'Escape',
        category: 'selection',
        handler: () => clear(),
      },
      {
        id: 'invert-selection',
        label: 'Invert Selection',
        description: 'Invert current selection',
        keys: 'Ctrl+I',
        category: 'selection',
        enabled: selectedCount > 0 && totalSamples > 0,
        handler: () => invert(totalSamples),
        preventDefault: true,
      },
      {
        id: 'save-selection',
        label: 'Save Selection',
        description: 'Save current selection',
        keys: 'Ctrl+S',
        category: 'selection',
        enabled: !!onSaveSelection && selectedCount > 0,
        handler: () => onSaveSelection?.(),
        preventDefault: true,
      },
      {
        id: 'pin-selection',
        label: 'Pin Selection',
        description: 'Pin selected samples (always visible)',
        keys: 'Ctrl+P',
        category: 'selection',
        enabled: selectedCount > 0,
        handler: () => pin(Array.from(selectedSamples)),
        preventDefault: true,
      },
      {
        id: 'clear-pins',
        label: 'Clear Pins',
        description: 'Unpin all pinned samples',
        keys: 'Ctrl+Shift+P',
        category: 'selection',
        enabled: pinnedSamples.size > 0,
        handler: () => clearPins(),
        preventDefault: true,
      },

      // Pipeline
      {
        id: 'undo',
        label: 'Undo',
        description: 'Undo last action',
        keys: 'Ctrl+Z',
        category: 'pipeline',
        enabled: canUndo || canUndoSelection,
        handler: () => {
          if (canUndo && onUndo) onUndo();
          else if (canUndoSelection) selectionUndo();
        },
        preventDefault: true,
      },
      {
        id: 'redo',
        label: 'Redo',
        description: 'Redo last undone action',
        keys: 'Ctrl+Shift+Z',
        category: 'pipeline',
        enabled: canRedo || canRedoSelection,
        handler: () => {
          if (canRedo && onRedo) onRedo();
          else if (canRedoSelection) selectionRedo();
        },
        preventDefault: true,
      },
      {
        id: 'redo-alt',
        label: 'Redo (Alt)',
        description: 'Redo last undone action (alternative)',
        keys: 'Ctrl+Y',
        category: 'pipeline',
        enabled: canRedo || canRedoSelection,
        handler: () => {
          if (canRedo && onRedo) onRedo();
          else if (canRedoSelection) selectionRedo();
        },
        preventDefault: true,
      },
      {
        id: 'clear-pipeline',
        label: 'Clear Pipeline',
        description: 'Remove all operators',
        keys: 'Ctrl+Backspace',
        category: 'pipeline',
        enabled: !!onClearPipeline,
        handler: () => onClearPipeline?.(),
        preventDefault: true,
      },

      // View (chart toggles)
      {
        id: 'toggle-spectra',
        label: 'Toggle Spectra',
        description: 'Show/hide Spectra chart',
        keys: '1',
        category: 'view',
        enabled: !!onToggleChart,
        handler: () => onToggleChart?.(0),
      },
      {
        id: 'toggle-histogram',
        label: 'Toggle Histogram',
        description: 'Show/hide Histogram chart',
        keys: '2',
        category: 'view',
        enabled: !!onToggleChart,
        handler: () => onToggleChart?.(1),
      },
      {
        id: 'toggle-folds',
        label: 'Toggle Folds',
        description: 'Show/hide Folds chart',
        keys: '3',
        category: 'view',
        enabled: !!onToggleChart,
        handler: () => onToggleChart?.(2),
      },
      {
        id: 'toggle-pca',
        label: 'Toggle PCA',
        description: 'Show/hide PCA chart',
        keys: '4',
        category: 'view',
        enabled: !!onToggleChart,
        handler: () => onToggleChart?.(3),
      },
      {
        id: 'toggle-repetitions',
        label: 'Toggle Repetitions',
        description: 'Show/hide Repetitions chart',
        keys: '5',
        category: 'view',
        enabled: !!onToggleChart,
        handler: () => onToggleChart?.(4),
      },

      // Export
      {
        id: 'export-png',
        label: 'Export PNG',
        description: 'Export visible charts as PNG',
        keys: 'Ctrl+Shift+E',
        category: 'export',
        enabled: !!onExportPng,
        handler: () => onExportPng?.(),
        preventDefault: true,
      },
      {
        id: 'export-data',
        label: 'Export Data',
        description: 'Export data as CSV',
        keys: 'Ctrl+Shift+D',
        category: 'export',
        enabled: !!onExportData,
        handler: () => onExportData?.(),
        preventDefault: true,
      },
    ],
    [
      totalSamples,
      selectedCount,
      canUndo,
      canRedo,
      canUndoSelection,
      canRedoSelection,
      selectAll,
      clear,
      invert,
      pin,
      clearPins,
      pinnedSamples,
      selectedSamples,
      selectionUndo,
      selectionRedo,
      onUndo,
      onRedo,
      onClearPipeline,
      onSaveSelection,
      onExportData,
      onExportPng,
      onToggleChart,
      onShowHelp,
      onRefresh,
    ]
  );

  // Combine default and custom shortcuts
  const allShortcuts = useMemo(
    () => [...defaultShortcuts, ...customShortcuts],
    [defaultShortcuts, customShortcuts]
  );

  // Group by category
  const shortcutsByCategory = useMemo(() => {
    const grouped: Record<ShortcutCategory, KeyboardShortcut[]> = {
      selection: [],
      navigation: [],
      pipeline: [],
      view: [],
      export: [],
      general: [],
    };

    allShortcuts.forEach((shortcut) => {
      if (shortcut.enabled !== false) {
        grouped[shortcut.category].push(shortcut);
      }
    });

    return grouped;
  }, [allShortcuts]);

  // Detect conflicts
  const conflicts = useMemo(() => detectConflicts(allShortcuts), [allShortcuts]);

  // Log conflicts in development
  useEffect(() => {
    if (conflicts.length > 0 && process.env.NODE_ENV === 'development') {
      console.warn('[usePlaygroundShortcuts] Detected shortcut conflicts:', conflicts);
    }
  }, [conflicts]);

  // Create key handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      // Skip if in input field
      if (isInputElement(e.target)) return;

      const pressedKeys = eventToKeys(e);

      // Find matching shortcut
      const shortcut = allShortcuts.find((s) => {
        if (s.enabled === false) return false;
        return normalizeKeys(s.keys) === pressedKeys;
      });

      if (shortcut) {
        if (shortcut.preventDefault) {
          e.preventDefault();
        }
        shortcut.handler();
      }
    },
    [enabled, allShortcuts]
  );

  // Register keyboard listener
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Register custom shortcut
  const registerShortcut = useCallback(
    (shortcut: Omit<KeyboardShortcut, 'id'> & { id?: string }) => {
      const id = shortcut.id ?? `custom-${Date.now()}`;
      setCustomShortcuts((prev) => {
        // Remove existing with same id
        const filtered = prev.filter((s) => s.id !== id);
        return [...filtered, { ...shortcut, id } as KeyboardShortcut];
      });
    },
    []
  );

  // Unregister custom shortcut
  const unregisterShortcut = useCallback((id: string) => {
    setCustomShortcuts((prev) => prev.filter((s) => s.id !== id));
  }, []);

  return {
    shortcuts: allShortcuts.filter((s) => s.enabled !== false),
    shortcutsByCategory,
    conflicts,
    showHelp,
    setShowHelp,
    registerShortcut,
    unregisterShortcut,
  };
}

export default usePlaygroundShortcuts;
