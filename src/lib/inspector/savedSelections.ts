import type { InspectorSavedSelection } from '@/types/inspector';

export const INSPECTOR_SELECTION_COLORS = [
  { nameKey: 'inspector.saved.colors.blue', value: '#3b82f6' },
  { nameKey: 'inspector.saved.colors.green', value: '#22c55e' },
  { nameKey: 'inspector.saved.colors.orange', value: '#f97316' },
  { nameKey: 'inspector.saved.colors.purple', value: '#a855f7' },
  { nameKey: 'inspector.saved.colors.pink', value: '#ec4899' },
  { nameKey: 'inspector.saved.colors.cyan', value: '#06b6d4' },
  { nameKey: 'inspector.saved.colors.yellow', value: '#eab308' },
  { nameKey: 'inspector.saved.colors.red', value: '#ef4444' },
];

export const DEFAULT_INSPECTOR_SELECTION_COLOR = INSPECTOR_SELECTION_COLORS[0].value;

export function findActiveInspectorSavedSelectionId({
  savedSelections,
  selectedChains,
  selectedCount,
}: {
  savedSelections: InspectorSavedSelection[];
  selectedChains: Set<string>;
  selectedCount: number;
}): string | undefined {
  return savedSelections.find((selection) => {
    if (selection.chain_ids.length !== selectedCount) return false;
    return selection.chain_ids.every((id) => selectedChains.has(id));
  })?.id;
}

export function buildInspectorSavedSelectionsJson(savedSelections: InspectorSavedSelection[]): string {
  return JSON.stringify(savedSelections, null, 2);
}

export function parseImportableInspectorSavedSelections(text: string): InspectorSavedSelection[] {
  const imported = JSON.parse(text) as unknown;
  if (!Array.isArray(imported)) {
    throw new Error('Invalid saved-selection export');
  }

  return imported.filter((selection): selection is InspectorSavedSelection => {
    if (!selection || typeof selection !== 'object') return false;
    const candidate = selection as Partial<InspectorSavedSelection>;
    return typeof candidate.name === 'string'
      && Array.isArray(candidate.chain_ids)
      && candidate.chain_ids.length > 0
      && candidate.chain_ids.every((id) => typeof id === 'string');
  });
}
