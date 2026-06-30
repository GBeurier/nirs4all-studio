/**
 * UnifiedOperatorCard - Operator card for unified format
 *
 * Supports both preprocessing and splitting operators.
 * Uses dynamic parameter rendering based on operator definition.
 * Shows filter statistics ("N samples removed") for filter operators.
 */

import { useState, useCallback, useMemo } from 'react';
import {
  TooltipProvider,
} from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { UnifiedOperator, OperatorParamInfo } from '@/types/playground';
import type { SampleMetadata } from '@/types/spectral';
import {
  buildLocalMetadataColumns,
  formatUnifiedOperatorName,
  getUnifiedOperatorBorderClass,
  getUnifiedOperatorTypeFlags,
  hasRenderableOperatorParams,
  supportsRuntimeGroupBy,
} from '@/lib/playground/unifiedOperatorCardData';
import { DynamicParamRenderer } from './UnifiedOperatorCardParams';
import { UnifiedOperatorCardErrorDialog } from './UnifiedOperatorCardErrorDialog';
import { UnifiedOperatorCardHeader } from './UnifiedOperatorCardHeader';
import type { SplitRuntimeMetadata, UnifiedOperatorFilterStats } from './UnifiedOperatorCardTypes';

interface UnifiedOperatorCardProps {
  operator: UnifiedOperator;
  index: number;
  paramDefs?: Record<string, OperatorParamInfo>;
  description?: string;
  splitMetadata?: SplitRuntimeMetadata;
  /** Filter statistics from execution result - name is optional since we key by operator name externally */
  filterStats?: UnifiedOperatorFilterStats;
  /** Error message if this operator failed during execution */
  errorMessage?: string;
  /** Current dataset ID for dynamic parameter fetching (e.g., MetadataFilter) */
  datasetId?: string;
  /** Local metadata rows already loaded in the playground */
  metadataRows?: SampleMetadata[];
  onUpdate: (id: string, updates: Partial<UnifiedOperator>) => void;
  onUpdateParams: (id: string, params: Record<string, unknown>) => void;
  onRemove: (id: string) => void;
  onToggle: (id: string) => void;
  onDragStart: (e: React.DragEvent, index: number) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDragEnd: () => void;
  isDragging: boolean;
}

export function UnifiedOperatorCard({
  operator,
  index,
  paramDefs,
  description,
  splitMetadata,
  filterStats,
  errorMessage,
  datasetId,
  metadataRows,
  onUpdate,
  onUpdateParams,
  onRemove,
  onToggle,
  onDragStart,
  onDragOver,
  onDragEnd,
  isDragging,
}: UnifiedOperatorCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showErrorDialog, setShowErrorDialog] = useState(false);

  const { isSplitter, isFilter, isAugmentation } = getUnifiedOperatorTypeFlags(operator.type);
  const localMetadataColumns = useMemo(() => buildLocalMetadataColumns(metadataRows), [metadataRows]);
  const hasRuntimeGroupBy = isSplitter && supportsRuntimeGroupBy(splitMetadata);
  const hasParams = hasRenderableOperatorParams({ paramDefs, hasRuntimeGroupBy });
  const hasError = !!errorMessage;

  const displayName = formatUnifiedOperatorName(operator.name);
  const borderColor = getUnifiedOperatorBorderClass({
    hasError,
    isFilter,
    isSplitter,
    isAugmentation,
  });

  const handleCopyError = useCallback(() => {
    if (!errorMessage) return;
    navigator.clipboard.writeText(errorMessage).then(
      () => toast.success('Error copied to clipboard'),
      () => toast.error('Failed to copy error')
    );
  }, [errorMessage]);

  return (
    <TooltipProvider>
      <div
        draggable
        onDragStart={(e) => onDragStart(e, index)}
        onDragOver={(e) => onDragOver(e, index)}
        onDragEnd={onDragEnd}
        className={cn(
          'bg-muted rounded-lg border transition-all duration-200',
          isDragging && 'opacity-50 scale-95',
          !operator.enabled && 'opacity-60',
          borderColor
        )}
      >
        <UnifiedOperatorCardHeader
          index={index}
          displayName={displayName}
          description={description}
          isFilter={isFilter}
          isSplitter={isSplitter}
          hasError={hasError}
          filterStats={filterStats}
          enabled={operator.enabled}
          hasParams={hasParams}
          isExpanded={isExpanded}
          onOpenError={() => setShowErrorDialog(true)}
          onToggleEnabled={() => onToggle(operator.id)}
          onToggleExpanded={() => setIsExpanded((expanded) => !expanded)}
          onRemove={() => onRemove(operator.id)}
        />

        {isExpanded && hasParams && (
          <div className="px-3 pb-3 pt-1 border-t border-border mt-1 space-y-3">
            <DynamicParamRenderer
              params={operator.params}
              paramDefs={paramDefs ?? {}}
              datasetId={datasetId}
              splitMetadata={splitMetadata}
              localMetadataColumns={localMetadataColumns}
              onUpdate={(key, value) => onUpdateParams(operator.id, { [key]: value })}
            />
          </div>
        )}
      </div>

      <UnifiedOperatorCardErrorDialog
        open={showErrorDialog}
        displayName={displayName}
        errorMessage={errorMessage}
        onOpenChange={setShowErrorDialog}
        onCopyError={handleCopyError}
      />
    </TooltipProvider>
  );
}

export default UnifiedOperatorCard;
