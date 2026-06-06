/**
 * Identity-generic primitives shared by the two selection providers
 * (Playground SelectionContext on `number` sample indices, Inspector
 * InspectorSelectionContext on `string` chain ids).
 *
 * Both implement the same set-based selection surface (SELECT/DESELECT/TOGGLE/
 * SELECT_ALL/INVERT/CLEAR with replace/add/remove/toggle modes), the same
 * bounded undo history, the same pin set, and the same sessionStorage shape.
 * This module owns that identity-agnostic half so the two reducers cannot drift
 * (FE-05-state: the history block was inlined 15× in one twin and extracted in
 * the other). Playground-only actions (range/intersect/replace-if-sole) and the
 * hover/keyboard ownership stay in each provider.
 */

/** Mutation mode shared by both selection providers. */
export type SelectionModeBase = 'replace' | 'add' | 'remove' | 'toggle';

/** Bound on the undo history depth. */
export const MAX_HISTORY = 10;

/** Apply a {@link SelectionModeBase} to `current`, returning a new Set. */
export function applySelectionMode<T>(current: Set<T>, ids: readonly T[], mode: SelectionModeBase): Set<T> {
  switch (mode) {
    case 'add':
      return new Set<T>([...current, ...ids]);
    case 'remove':
      return removeFromSet(current, ids);
    case 'toggle': {
      let next = current;
      ids.forEach(id => { next = toggleInSet(next, id); });
      return next;
    }
    case 'replace':
    default:
      return new Set(ids);
  }
}

/** Toggle a single id in/out of a set, returning a new Set. */
export function toggleInSet<T>(current: Set<T>, id: T): Set<T> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Union `ids` into a set, returning a new Set. */
export function addToSet<T>(current: Set<T>, ids: readonly T[]): Set<T> {
  return new Set<T>([...current, ...ids]);
}

/** Remove every id from a set, returning a new Set. */
export function removeFromSet<T>(current: Set<T>, ids: readonly T[]): Set<T> {
  const next = new Set(current);
  ids.forEach(id => next.delete(id));
  return next;
}

/** Slice of state mutated whenever a new selection snapshot is recorded. */
export interface HistorySlice<T> {
  selectionHistory: Set<T>[];
  historyIndex: number;
}

/**
 * Append `newSelection` to the bounded undo history, truncating any redo branch
 * and dropping the oldest entry past {@link MAX_HISTORY}.
 */
export function pushHistory<T>(history: Set<T>[], historyIndex: number, newSelection: Set<T>): HistorySlice<T> {
  const newHistory = history.slice(0, historyIndex + 1);
  newHistory.push(newSelection);
  if (newHistory.length > MAX_HISTORY) newHistory.shift();
  return { selectionHistory: newHistory, historyIndex: Math.min(newHistory.length - 1, MAX_HISTORY - 1) };
}

/** Step history back one entry (reusing its stored Set); null when no undo. */
export function undoHistory<T>(history: Set<T>[], historyIndex: number): { selection: Set<T>; historyIndex: number } | null {
  if (historyIndex <= 0) return null;
  return { selection: history[historyIndex - 1], historyIndex: historyIndex - 1 };
}

/** Step history forward one entry (reusing its stored Set); null when no redo. */
export function redoHistory<T>(history: Set<T>[], historyIndex: number): { selection: Set<T>; historyIndex: number } | null {
  if (historyIndex >= history.length - 1) return null;
  return { selection: history[historyIndex + 1], historyIndex: historyIndex + 1 };
}

/** The index set [0, total) used by SELECT_ALL/INVERT on numeric identities. */
export function rangeIndices(total: number): number[] {
  return Array.from({ length: total }, (_, i) => i);
}

/**
 * Provider-specific persisted field names. Each provider keeps its own historical
 * keys (`selectedSamples`/`pinnedSamples` vs `selectedChains`/`pinnedChains`) so
 * previously persisted sessions stay readable; only the plumbing is shared.
 */
export interface PersistFieldNames {
  selected: string;
  pinned: string;
  savedSelections: string;
}

/** Persist selection/pin sets + saved selections under `key`; failures swallowed. */
export function persistSelection<T, S>(key: string, fields: PersistFieldNames, selected: Set<T>, pinned: Set<T>, savedSelections: S[]): void {
  try {
    sessionStorage.setItem(key, JSON.stringify({
      [fields.selected]: Array.from(selected),
      [fields.pinned]: Array.from(pinned),
      [fields.savedSelections]: savedSelections,
    }));
  } catch {
    /* sessionStorage unavailable or full — selection is non-critical */
  }
}

/** Canonical selection state read back by {@link loadPersistedSelection}. */
export interface PersistedSelection<T, S> {
  selected?: T[];
  pinned?: T[];
  savedSelections?: S[];
}

/** Read persisted state, normalizing provider field names; null when absent/invalid. */
export function loadPersistedSelection<T, S>(key: string, fields: PersistFieldNames): PersistedSelection<T, S> | null {
  try {
    const stored = sessionStorage.getItem(key);
    if (stored) {
      const raw = JSON.parse(stored) as Record<string, unknown>;
      return {
        selected: raw[fields.selected] as T[] | undefined,
        pinned: raw[fields.pinned] as T[] | undefined,
        savedSelections: raw[fields.savedSelections] as S[] | undefined,
      };
    }
  } catch {
    /* corrupt/unavailable storage — fall back to empty selection */
  }
  return null;
}
