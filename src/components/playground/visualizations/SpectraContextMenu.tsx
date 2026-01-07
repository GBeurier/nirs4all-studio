/**
 * SpectraContextMenu - Context menu for spectra chart interactions
 *
 * Phase 3 Implementation: Right-click context menu for sample actions
 *
 * Features:
 * - Pin/unpin samples
 * - Select similar samples
 * - Export selected samples
 * - Remove samples from view
 * - Copy sample info
 */

import { useCallback, useMemo, type ReactNode } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  ContextMenuShortcut,
} from '@/components/ui/context-menu';
import {
  Pin,
  PinOff,
  Check,
  CheckCheck,
  X,
  Copy,
  Download,
  Target,
  Filter,
  Eye,
  EyeOff,
  Trash2,
} from 'lucide-react';
import { useSelection } from '@/context/SelectionContext';

export interface SpectraContextMenuProps {
  /** The trigger element (chart area) */
  children: ReactNode;
  /** Index of the sample under the cursor (null if no sample) */
  hoveredSample: number | null;
  /** Sample IDs for labeling */
  sampleIds?: string[];
  /** Y values for display */
  yValues?: number[];
  /** Fold labels for display */
  folds?: string[];
  /** Callback when samples should be exported */
  onExportSamples?: (sampleIndices: number[]) => void;
  /** Callback when samples should be hidden */
  onHideSamples?: (sampleIndices: number[]) => void;
  /** Callback to select similar samples (e.g., same fold) */
  onSelectSimilar?: (sampleIdx: number, criterion: 'fold' | 'yRange' | 'outlier') => void;
  /** Disabled state */
  disabled?: boolean;
}

export function SpectraContextMenu({
  children,
  hoveredSample,
  sampleIds,
  yValues,
  folds,
  onExportSamples,
  onHideSamples,
  onSelectSimilar,
  disabled = false,
}: SpectraContextMenuProps) {
  const selectionCtx = useSelection();

  // Compute selection state
  const selectedSamples = selectionCtx?.selectedSamples ?? new Set<number>();
  const pinnedSamples = selectionCtx?.pinnedSamples ?? new Set<number>();
  const hasSelection = selectedSamples.size > 0;
  const hasPinned = pinnedSamples.size > 0;

  // Get info about hovered sample
  const hoveredInfo = useMemo(() => {
    if (hoveredSample === null) return null;
    return {
      id: sampleIds?.[hoveredSample] ?? `Sample ${hoveredSample}`,
      y: yValues?.[hoveredSample],
      fold: folds?.[hoveredSample],
      isSelected: selectedSamples.has(hoveredSample),
      isPinned: pinnedSamples.has(hoveredSample),
    };
  }, [hoveredSample, sampleIds, yValues, folds, selectedSamples, pinnedSamples]);

  // Handle pin/unpin
  const handleTogglePin = useCallback(() => {
    if (hoveredSample === null || !selectionCtx) return;
    if (hoveredInfo?.isPinned) {
      selectionCtx.unpin([hoveredSample]);
    } else {
      selectionCtx.pin([hoveredSample]);
    }
  }, [hoveredSample, hoveredInfo?.isPinned, selectionCtx]);

  const handlePinAll = useCallback(() => {
    if (!selectionCtx || selectedSamples.size === 0) return;
    selectionCtx.pin(Array.from(selectedSamples));
  }, [selectionCtx, selectedSamples]);

  const handleUnpinAll = useCallback(() => {
    if (!selectionCtx || pinnedSamples.size === 0) return;
    selectionCtx.unpin(Array.from(pinnedSamples));
  }, [selectionCtx, pinnedSamples]);

  // Handle selection actions
  const handleSelect = useCallback(() => {
    if (hoveredSample === null || !selectionCtx) return;
    selectionCtx.select([hoveredSample], 'replace');
  }, [hoveredSample, selectionCtx]);

  const handleAddToSelection = useCallback(() => {
    if (hoveredSample === null || !selectionCtx) return;
    selectionCtx.select([hoveredSample], 'add');
  }, [hoveredSample, selectionCtx]);

  const handleRemoveFromSelection = useCallback(() => {
    if (hoveredSample === null || !selectionCtx) return;
    selectionCtx.toggle([hoveredSample]);
  }, [hoveredSample, selectionCtx]);

  const handleSelectAll = useCallback(() => {
    // This would need total sample count - could emit an event instead
  }, []);

  const handleClearSelection = useCallback(() => {
    selectionCtx?.clear();
  }, [selectionCtx]);

  const handleInvertSelection = useCallback(() => {
    // Emit an event for parent to handle
  }, []);

  // Handle copy to clipboard
  const handleCopySampleInfo = useCallback(() => {
    if (hoveredInfo === null) return;
    const info = [
      `ID: ${hoveredInfo.id}`,
      hoveredInfo.y !== undefined ? `Y: ${hoveredInfo.y.toFixed(4)}` : null,
      hoveredInfo.fold ? `Fold: ${hoveredInfo.fold}` : null,
    ].filter(Boolean).join('\n');
    navigator.clipboard.writeText(info);
  }, [hoveredInfo]);

  const handleCopySelectedInfo = useCallback(() => {
    const infos: string[] = [];
    selectedSamples.forEach((idx) => {
      const info = [
        sampleIds?.[idx] ?? `Sample ${idx}`,
        yValues?.[idx]?.toFixed(4) ?? 'N/A',
        folds?.[idx] ?? 'N/A',
      ].join('\t');
      infos.push(info);
    });
    navigator.clipboard.writeText('ID\tY\tFold\n' + infos.join('\n'));
  }, [selectedSamples, sampleIds, yValues, folds]);

  // Handle export
  const handleExport = useCallback(() => {
    if (hasSelection && onExportSamples) {
      onExportSamples(Array.from(selectedSamples));
    }
  }, [hasSelection, selectedSamples, onExportSamples]);

  const handleExportHovered = useCallback(() => {
    if (hoveredSample !== null && onExportSamples) {
      onExportSamples([hoveredSample]);
    }
  }, [hoveredSample, onExportSamples]);

  // Handle hide/remove
  const handleHideSelected = useCallback(() => {
    if (hasSelection && onHideSamples) {
      onHideSamples(Array.from(selectedSamples));
    }
  }, [hasSelection, selectedSamples, onHideSamples]);

  const handleHideHovered = useCallback(() => {
    if (hoveredSample !== null && onHideSamples) {
      onHideSamples([hoveredSample]);
    }
  }, [hoveredSample, onHideSamples]);

  // Handle select similar
  const handleSelectSimilarFold = useCallback(() => {
    if (hoveredSample !== null && onSelectSimilar) {
      onSelectSimilar(hoveredSample, 'fold');
    }
  }, [hoveredSample, onSelectSimilar]);

  const handleSelectSimilarY = useCallback(() => {
    if (hoveredSample !== null && onSelectSimilar) {
      onSelectSimilar(hoveredSample, 'yRange');
    }
  }, [hoveredSample, onSelectSimilar]);

  if (disabled) {
    return <>{children}</>;
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {/* Sample info header */}
        {hoveredInfo && (
          <>
            <ContextMenuLabel className="text-xs font-normal">
              <span className="font-semibold">{hoveredInfo.id}</span>
              {hoveredInfo.y !== undefined && (
                <span className="text-muted-foreground ml-2">
                  Y={hoveredInfo.y.toFixed(3)}
                </span>
              )}
              {hoveredInfo.fold && (
                <span className="text-muted-foreground ml-2">
                  [{hoveredInfo.fold}]
                </span>
              )}
            </ContextMenuLabel>
            <ContextMenuSeparator />
          </>
        )}

        {/* Selection actions for hovered sample */}
        {hoveredInfo && (
          <>
            {!hoveredInfo.isSelected ? (
              <ContextMenuItem onClick={handleSelect}>
                <Check className="w-3.5 h-3.5 mr-2" />
                Select this sample
              </ContextMenuItem>
            ) : (
              <ContextMenuItem onClick={handleRemoveFromSelection}>
                <X className="w-3.5 h-3.5 mr-2" />
                Deselect this sample
              </ContextMenuItem>
            )}

            {!hoveredInfo.isSelected && hasSelection && (
              <ContextMenuItem onClick={handleAddToSelection}>
                <CheckCheck className="w-3.5 h-3.5 mr-2" />
                Add to selection
              </ContextMenuItem>
            )}

            <ContextMenuItem onClick={handleTogglePin}>
              {hoveredInfo.isPinned ? (
                <>
                  <PinOff className="w-3.5 h-3.5 mr-2" />
                  Unpin this sample
                </>
              ) : (
                <>
                  <Pin className="w-3.5 h-3.5 mr-2" />
                  Pin this sample
                </>
              )}
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}

        {/* Find similar submenu */}
        {hoveredInfo && onSelectSimilar && (
          <>
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Filter className="w-3.5 h-3.5 mr-2" />
                Select similar...
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {hoveredInfo.fold && (
                  <ContextMenuItem onClick={handleSelectSimilarFold}>
                    <Target className="w-3.5 h-3.5 mr-2" />
                    Same fold ({hoveredInfo.fold})
                  </ContextMenuItem>
                )}
                {hoveredInfo.y !== undefined && (
                  <ContextMenuItem onClick={handleSelectSimilarY}>
                    <Target className="w-3.5 h-3.5 mr-2" />
                    Similar Y value (±10%)
                  </ContextMenuItem>
                )}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
          </>
        )}

        {/* Bulk selection actions */}
        {hasSelection && (
          <>
            <ContextMenuLabel className="text-[10px] text-muted-foreground">
              {selectedSamples.size} sample{selectedSamples.size > 1 ? 's' : ''} selected
            </ContextMenuLabel>
            <ContextMenuItem onClick={handlePinAll}>
              <Pin className="w-3.5 h-3.5 mr-2" />
              Pin selected samples
              <ContextMenuShortcut>P</ContextMenuShortcut>
            </ContextMenuItem>
            {onExportSamples && (
              <ContextMenuItem onClick={handleExport}>
                <Download className="w-3.5 h-3.5 mr-2" />
                Export selected spectra
              </ContextMenuItem>
            )}
            <ContextMenuItem onClick={handleCopySelectedInfo}>
              <Copy className="w-3.5 h-3.5 mr-2" />
              Copy selected info
            </ContextMenuItem>
            {onHideSamples && (
              <ContextMenuItem onClick={handleHideSelected} className="text-destructive">
                <EyeOff className="w-3.5 h-3.5 mr-2" />
                Hide selected samples
              </ContextMenuItem>
            )}
            <ContextMenuItem onClick={handleClearSelection}>
              <X className="w-3.5 h-3.5 mr-2" />
              Clear selection
              <ContextMenuShortcut>Esc</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}

        {/* Pinned samples actions */}
        {hasPinned && (
          <>
            <ContextMenuLabel className="text-[10px] text-muted-foreground">
              {pinnedSamples.size} pinned sample{pinnedSamples.size > 1 ? 's' : ''}
            </ContextMenuLabel>
            <ContextMenuItem onClick={handleUnpinAll}>
              <PinOff className="w-3.5 h-3.5 mr-2" />
              Unpin all samples
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}

        {/* Copy actions */}
        {hoveredInfo && (
          <ContextMenuItem onClick={handleCopySampleInfo}>
            <Copy className="w-3.5 h-3.5 mr-2" />
            Copy sample info
          </ContextMenuItem>
        )}

        {/* Hovered-only actions when not selected */}
        {hoveredInfo && !hoveredInfo.isSelected && (
          <>
            {onExportSamples && (
              <ContextMenuItem onClick={handleExportHovered}>
                <Download className="w-3.5 h-3.5 mr-2" />
                Export this spectrum
              </ContextMenuItem>
            )}
            {onHideSamples && (
              <ContextMenuItem onClick={handleHideHovered} className="text-destructive">
                <EyeOff className="w-3.5 h-3.5 mr-2" />
                Hide this sample
              </ContextMenuItem>
            )}
          </>
        )}

        {/* Empty state */}
        {!hoveredInfo && !hasSelection && !hasPinned && (
          <ContextMenuItem disabled>
            <Eye className="w-3.5 h-3.5 mr-2 opacity-50" />
            Hover a spectrum line for options
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

export default SpectraContextMenu;
