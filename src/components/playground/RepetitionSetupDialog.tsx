/**
 * RepetitionSetupDialog - Configure repetition detection (Phase 4)
 *
 * Provides a modal dialog for users to configure how biological sample
 * repetitions are detected in their dataset. Supports:
 * - Auto-detection with pattern matching
 * - Manual metadata column selection
 * - Custom regex pattern extraction
 * - Live preview of detected groups
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Repeat } from 'lucide-react';
import {
  COMMON_REPETITION_PATTERNS,
  CUSTOM_REPETITION_PATTERN_INDEX,
  DEFAULT_REPETITION_PATTERN,
  detectRepetitionGroups,
  summarizeRepetitionGroups,
  validateRepetitionPattern,
  type RepetitionDetectionConfig,
  type RepetitionDetectionMethod,
  type RepetitionDistanceMetric,
} from '@/lib/playground/repetition';
import {
  DetectionMethodSelector,
  RepetitionDistanceMetricSelect,
  RepetitionMethodOptions,
  RepetitionPreviewPanel,
} from './RepetitionSetupDialogSections';

// ============= Types =============

export type DetectionMethod = RepetitionDetectionMethod;

export type RepetitionConfig = RepetitionDetectionConfig;

export interface RepetitionSetupDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog should close */
  onOpenChange: (open: boolean) => void;
  /** Current configuration */
  config: RepetitionConfig;
  /** Callback when configuration changes */
  onConfigChange: (config: RepetitionConfig) => void;
  /** Sample IDs for preview */
  sampleIds?: string[];
  /** Available metadata columns */
  metadataColumns?: string[];
  /** Callback when user confirms */
  onConfirm?: () => void;
}

// ============= Component =============

export function RepetitionSetupDialog({
  open,
  onOpenChange,
  config,
  onConfigChange,
  sampleIds = [],
  metadataColumns = [],
  onConfirm,
}: RepetitionSetupDialogProps) {
  // Local state for editing
  const [method, setMethod] = useState<RepetitionDetectionMethod>(config.method);
  const [metadataColumn, setMetadataColumn] = useState<string>(config.metadataColumn || '');
  const [pattern, setPattern] = useState<string>(config.pattern || DEFAULT_REPETITION_PATTERN);
  const [selectedPreset, setSelectedPreset] = useState<number>(0);
  const [customPattern, setCustomPattern] = useState<string>('');
  const [distanceMetric, setDistanceMetric] = useState<RepetitionDistanceMetric>(config.distanceMetric);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setMethod(config.method);
      setMetadataColumn(config.metadataColumn || '');
      setPattern(config.pattern || DEFAULT_REPETITION_PATTERN);
      setDistanceMetric(config.distanceMetric);
    }
  }, [open, config]);

  const patternError = useMemo(
    () => (method === 'pattern' ? validateRepetitionPattern(pattern) : null),
    [method, pattern],
  );

  const detectedGroups = useMemo(
    () => detectRepetitionGroups(sampleIds, method, pattern),
    [sampleIds, method, pattern],
  );

  const summary = useMemo(
    () => summarizeRepetitionGroups(detectedGroups),
    [detectedGroups],
  );

  // Handle preset selection
  const handlePresetChange = useCallback((index: number) => {
    setSelectedPreset(index);
    if (index < CUSTOM_REPETITION_PATTERN_INDEX) {
      setPattern(COMMON_REPETITION_PATTERNS[index]?.pattern ?? DEFAULT_REPETITION_PATTERN);
    } else {
      // Custom pattern
      setPattern(customPattern || '');
    }
  }, [customPattern]);

  const handleCustomPatternChange = useCallback((nextPattern: string) => {
    setCustomPattern(nextPattern);
    setPattern(nextPattern);
  }, []);

  // Handle confirm
  const handleConfirm = useCallback(() => {
    onConfigChange({
      method,
      metadataColumn: method === 'metadata' ? metadataColumn : undefined,
      pattern: method === 'pattern' ? pattern : undefined,
      distanceMetric,
    });
    onConfirm?.();
    onOpenChange(false);
  }, [method, metadataColumn, pattern, distanceMetric, onConfigChange, onConfirm, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Repeat className="w-5 h-5 text-primary" />
            Configure Repetition Detection
          </DialogTitle>
          <DialogDescription>
            Configure how biological sample repetitions are identified in your dataset.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-6 py-4">
          <DetectionMethodSelector
            method={method}
            metadataColumnCount={metadataColumns.length}
            onMethodChange={setMethod}
          />

          <RepetitionMethodOptions
            method={method}
            metadataColumn={metadataColumn}
            metadataColumns={metadataColumns}
            selectedPreset={selectedPreset}
            customPattern={customPattern}
            patternError={patternError}
            onMetadataColumnChange={setMetadataColumn}
            onPresetChange={handlePresetChange}
            onCustomPatternChange={handleCustomPatternChange}
          />

          <RepetitionDistanceMetricSelect
            distanceMetric={distanceMetric}
            onDistanceMetricChange={setDistanceMetric}
          />

          <RepetitionPreviewPanel
            detectedGroups={detectedGroups}
            summary={summary}
            sampleCount={sampleIds.length}
          />
        </div>

        <DialogFooter className="border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={
              (method === 'metadata' && !metadataColumn) ||
              (method === 'pattern' && !!patternError)
            }
          >
            Apply Configuration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default RepetitionSetupDialog;
