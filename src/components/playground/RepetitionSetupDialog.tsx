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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Repeat,
  Wand2,
  Table2,
  Regex,
  CheckCircle2,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============= Types =============

export type DetectionMethod = 'auto' | 'metadata' | 'pattern';

export interface RepetitionConfig {
  /** Detection method */
  method: DetectionMethod;
  /** Metadata column name (if method is 'metadata') */
  metadataColumn?: string;
  /** Regex pattern (if method is 'pattern') */
  pattern?: string;
  /** Distance metric to use */
  distanceMetric: 'pca' | 'umap' | 'euclidean' | 'mahalanobis';
}

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

interface DetectedGroup {
  bioSample: string;
  sampleIds: string[];
  count: number;
}

// ============= Common Patterns =============

const COMMON_PATTERNS = [
  { label: 'sample_rep1, sample_rep2', pattern: '^(.+?)[-_][Rr]ep\\d+$', example: 'Sample1_rep1' },
  { label: 'sample_1, sample_2', pattern: '^(.+?)[-_]\\d+$', example: 'Sample1_1' },
  { label: 'sample_A, sample_B', pattern: '^(.+?)[-_][A-Za-z]$', example: 'Sample1_A' },
  { label: 'sample (1), sample (2)', pattern: '^(.+?)\\s*\\(\\d+\\)$', example: 'Sample1 (1)' },
  { label: 'Custom pattern...', pattern: '', example: '' },
];

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
  const [method, setMethod] = useState<DetectionMethod>(config.method);
  const [metadataColumn, setMetadataColumn] = useState<string>(config.metadataColumn || '');
  const [pattern, setPattern] = useState<string>(config.pattern || '^(.+?)[-_][Rr]ep\\d+$');
  const [selectedPreset, setSelectedPreset] = useState<number>(0);
  const [customPattern, setCustomPattern] = useState<string>('');
  const [distanceMetric, setDistanceMetric] = useState(config.distanceMetric);
  const [patternError, setPatternError] = useState<string | null>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setMethod(config.method);
      setMetadataColumn(config.metadataColumn || '');
      setPattern(config.pattern || '^(.+?)[-_][Rr]ep\\d+$');
      setDistanceMetric(config.distanceMetric);
      setPatternError(null);
    }
  }, [open, config]);

  // Validate pattern
  useEffect(() => {
    if (method === 'pattern' && pattern) {
      try {
        new RegExp(pattern);
        setPatternError(null);
      } catch (e) {
        setPatternError(`Invalid regex: ${(e as Error).message}`);
      }
    } else {
      setPatternError(null);
    }
  }, [method, pattern]);

  // Detect groups based on current settings
  const detectedGroups = useMemo((): DetectedGroup[] => {
    if (sampleIds.length === 0) return [];

    if (method === 'auto') {
      // Try all patterns and pick the best one
      let bestGroups: DetectedGroup[] = [];
      let bestRepCount = 0;

      for (const preset of COMMON_PATTERNS) {
        if (!preset.pattern) continue;

        try {
          const regex = new RegExp(preset.pattern);
          const groups: Map<string, string[]> = new Map();

          for (const sampleId of sampleIds) {
            const match = regex.exec(sampleId);
            const bioSample = match ? match[1] : sampleId;
            if (!groups.has(bioSample)) {
              groups.set(bioSample, []);
            }
            groups.get(bioSample)!.push(sampleId);
          }

          const withReps = Array.from(groups.entries())
            .filter(([, samples]) => samples.length >= 2)
            .map(([bioSample, samples]) => ({
              bioSample,
              sampleIds: samples,
              count: samples.length,
            }));

          const repCount = withReps.reduce((sum, g) => sum + g.count, 0);
          if (repCount > bestRepCount) {
            bestRepCount = repCount;
            bestGroups = withReps;
          }
        } catch {
          // Invalid pattern, skip
        }
      }

      return bestGroups.slice(0, 20); // Limit for preview
    }

    if (method === 'pattern' && pattern) {
      try {
        const regex = new RegExp(pattern);
        const groups: Map<string, string[]> = new Map();

        for (const sampleId of sampleIds) {
          const match = regex.exec(sampleId);
          const bioSample = match ? match[1] : sampleId;
          if (!groups.has(bioSample)) {
            groups.set(bioSample, []);
          }
          groups.get(bioSample)!.push(sampleId);
        }

        return Array.from(groups.entries())
          .filter(([, samples]) => samples.length >= 2)
          .map(([bioSample, samples]) => ({
            bioSample,
            sampleIds: samples,
            count: samples.length,
          }))
          .slice(0, 20);
      } catch {
        return [];
      }
    }

    // Metadata column selection would need actual metadata values
    return [];
  }, [sampleIds, method, pattern]);

  // Summary stats
  const summary = useMemo(() => {
    if (detectedGroups.length === 0) {
      return { bioSamples: 0, totalReps: 0, avgReps: 0 };
    }

    const totalReps = detectedGroups.reduce((sum, g) => sum + g.count, 0);
    return {
      bioSamples: detectedGroups.length,
      totalReps,
      avgReps: totalReps / detectedGroups.length,
    };
  }, [detectedGroups]);

  // Handle preset selection
  const handlePresetChange = useCallback((index: number) => {
    setSelectedPreset(index);
    if (index < COMMON_PATTERNS.length - 1) {
      setPattern(COMMON_PATTERNS[index].pattern);
    } else {
      // Custom pattern
      setPattern(customPattern || '');
    }
  }, [customPattern]);

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
          {/* Detection Method */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Detection Method</Label>
            <RadioGroup
              value={method}
              onValueChange={(v) => setMethod(v as DetectionMethod)}
              className="grid grid-cols-3 gap-3"
            >
              <Label
                className={cn(
                  'flex flex-col items-center gap-2 p-3 rounded-lg border-2 cursor-pointer transition-colors',
                  method === 'auto'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50'
                )}
              >
                <RadioGroupItem value="auto" className="sr-only" />
                <Wand2 className="w-5 h-5 text-primary" />
                <span className="text-xs font-medium">Auto-detect</span>
              </Label>

              <Label
                className={cn(
                  'flex flex-col items-center gap-2 p-3 rounded-lg border-2 cursor-pointer transition-colors',
                  method === 'metadata'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50',
                  metadataColumns.length === 0 && 'opacity-50 cursor-not-allowed'
                )}
              >
                <RadioGroupItem
                  value="metadata"
                  className="sr-only"
                  disabled={metadataColumns.length === 0}
                />
                <Table2 className="w-5 h-5 text-primary" />
                <span className="text-xs font-medium">Metadata Column</span>
              </Label>

              <Label
                className={cn(
                  'flex flex-col items-center gap-2 p-3 rounded-lg border-2 cursor-pointer transition-colors',
                  method === 'pattern'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50'
                )}
              >
                <RadioGroupItem value="pattern" className="sr-only" />
                <Regex className="w-5 h-5 text-primary" />
                <span className="text-xs font-medium">Pattern</span>
              </Label>
            </RadioGroup>
          </div>

          {/* Method-specific options */}
          {method === 'auto' && (
            <Alert>
              <Info className="w-4 h-4" />
              <AlertTitle className="text-sm">Automatic Detection</AlertTitle>
              <AlertDescription className="text-xs">
                The system will try common patterns like &quot;sample_rep1&quot;, &quot;sample_1&quot;,
                and &quot;sample_A&quot; to identify repetitions in your sample IDs.
              </AlertDescription>
            </Alert>
          )}

          {method === 'metadata' && (
            <div className="space-y-2">
              <Label htmlFor="metadata-column" className="text-sm">
                Biological Sample Column
              </Label>
              <Select value={metadataColumn} onValueChange={setMetadataColumn}>
                <SelectTrigger id="metadata-column">
                  <SelectValue placeholder="Select column..." />
                </SelectTrigger>
                <SelectContent>
                  {metadataColumns.map((col) => (
                    <SelectItem key={col} value={col}>
                      {col}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Select the metadata column that contains the biological sample ID
                (samples with the same value are repetitions).
              </p>
            </div>
          )}

          {method === 'pattern' && (
            <div className="space-y-3">
              <Label className="text-sm">Pattern Template</Label>
              <RadioGroup
                value={String(selectedPreset)}
                onValueChange={(v) => handlePresetChange(Number(v))}
                className="space-y-2"
              >
                {COMMON_PATTERNS.map((preset, index) => (
                  <Label
                    key={index}
                    className={cn(
                      'flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors',
                      selectedPreset === index
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/30'
                    )}
                  >
                    <RadioGroupItem value={String(index)} />
                    <div className="flex-1">
                      <span className="text-sm">{preset.label}</span>
                      {preset.example && (
                        <span className="text-xs text-muted-foreground ml-2">
                          e.g., {preset.example}
                        </span>
                      )}
                    </div>
                  </Label>
                ))}
              </RadioGroup>

              {selectedPreset === COMMON_PATTERNS.length - 1 && (
                <div className="space-y-2 mt-3">
                  <Label htmlFor="custom-pattern" className="text-sm">
                    Custom Regex Pattern
                  </Label>
                  <Input
                    id="custom-pattern"
                    value={customPattern}
                    onChange={(e) => {
                      setCustomPattern(e.target.value);
                      setPattern(e.target.value);
                    }}
                    placeholder="^(.+?)[-_]\d+$"
                    className={cn(patternError && 'border-red-500')}
                  />
                  <p className="text-xs text-muted-foreground">
                    The first capture group should match the biological sample ID.
                    Example: <code>^(.+?)[-_]rep\d+$</code>
                  </p>
                  {patternError && (
                    <p className="text-xs text-red-500">{patternError}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Distance Metric */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Distance Metric</Label>
            <Select value={distanceMetric} onValueChange={(v) => setDistanceMetric(v as typeof distanceMetric)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pca">PCA Distance (recommended)</SelectItem>
                <SelectItem value="umap">UMAP Distance</SelectItem>
                <SelectItem value="euclidean">Spectral Euclidean</SelectItem>
                <SelectItem value="mahalanobis">Mahalanobis Distance</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Distance between repetitions will be computed in this space.
            </p>
          </div>

          {/* Preview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Preview</Label>
              {summary.bioSamples > 0 ? (
                <Badge variant="secondary" className="text-xs">
                  <CheckCircle2 className="w-3 h-3 mr-1 text-green-500" />
                  {summary.bioSamples} bio samples, {summary.totalReps} reps
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs">
                  <AlertTriangle className="w-3 h-3 mr-1 text-amber-500" />
                  No repetitions detected
                </Badge>
              )}
            </div>

            <ScrollArea className="h-[140px] border rounded-lg">
              {detectedGroups.length > 0 ? (
                <div className="p-2 space-y-1.5">
                  {detectedGroups.map((group) => (
                    <div
                      key={group.bioSample}
                      className="flex items-center justify-between py-1 px-2 rounded bg-muted/50 text-xs"
                    >
                      <span className="font-medium truncate max-w-[200px]">
                        {group.bioSample}
                      </span>
                      <span className="text-muted-foreground">
                        {group.count} reps: {group.sampleIds.slice(0, 3).join(', ')}
                        {group.sampleIds.length > 3 && '...'}
                      </span>
                    </div>
                  ))}
                  {summary.bioSamples > 20 && (
                    <p className="text-xs text-muted-foreground text-center py-1">
                      ... and {summary.bioSamples - 20} more groups
                    </p>
                  )}
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                  {sampleIds.length === 0
                    ? 'Load a dataset to preview detection'
                    : 'No repetitions found with current settings'}
                </div>
              )}
            </ScrollArea>
          </div>
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
