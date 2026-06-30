import { AlertTriangle, CheckCircle2, Info, Regex, Table2, Wand2 } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  COMMON_REPETITION_PATTERNS,
  CUSTOM_REPETITION_PATTERN_INDEX,
  type DetectedRepetitionGroup,
  type RepetitionDetectionMethod,
  type RepetitionDetectionSummary,
  type RepetitionDistanceMetric,
} from '@/lib/playground/repetition';

interface DetectionMethodSelectorProps {
  method: RepetitionDetectionMethod;
  metadataColumnCount: number;
  onMethodChange: (method: RepetitionDetectionMethod) => void;
}

export function DetectionMethodSelector({
  method,
  metadataColumnCount,
  onMethodChange,
}: DetectionMethodSelectorProps) {
  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">Detection Method</Label>
      <RadioGroup
        value={method}
        onValueChange={(value) => onMethodChange(value as RepetitionDetectionMethod)}
        className="grid grid-cols-3 gap-3"
      >
        <Label
          className={cn(
            'flex flex-col items-center gap-2 p-3 rounded-lg border-2 cursor-pointer transition-colors',
            method === 'auto'
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/50',
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
            metadataColumnCount === 0 && 'opacity-50 cursor-not-allowed',
          )}
        >
          <RadioGroupItem value="metadata" className="sr-only" disabled={metadataColumnCount === 0} />
          <Table2 className="w-5 h-5 text-primary" />
          <span className="text-xs font-medium">Metadata Column</span>
        </Label>

        <Label
          className={cn(
            'flex flex-col items-center gap-2 p-3 rounded-lg border-2 cursor-pointer transition-colors',
            method === 'pattern'
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/50',
          )}
        >
          <RadioGroupItem value="pattern" className="sr-only" />
          <Regex className="w-5 h-5 text-primary" />
          <span className="text-xs font-medium">Pattern</span>
        </Label>
      </RadioGroup>
    </div>
  );
}

interface RepetitionMethodOptionsProps {
  method: RepetitionDetectionMethod;
  metadataColumn: string;
  metadataColumns: string[];
  selectedPreset: number;
  customPattern: string;
  patternError: string | null;
  onMetadataColumnChange: (column: string) => void;
  onPresetChange: (index: number) => void;
  onCustomPatternChange: (pattern: string) => void;
}

export function RepetitionMethodOptions({
  method,
  metadataColumn,
  metadataColumns,
  selectedPreset,
  customPattern,
  patternError,
  onMetadataColumnChange,
  onPresetChange,
  onCustomPatternChange,
}: RepetitionMethodOptionsProps) {
  if (method === 'auto') {
    return (
      <Alert>
        <Info className="w-4 h-4" />
        <AlertTitle className="text-sm">Automatic Detection</AlertTitle>
        <AlertDescription className="text-xs">
          The system will try common patterns like &quot;sample_rep1&quot;, &quot;sample_1&quot;,
          and &quot;sample_A&quot; to identify repetitions in your sample IDs.
        </AlertDescription>
      </Alert>
    );
  }

  if (method === 'metadata') {
    return (
      <div className="space-y-2">
        <Label htmlFor="metadata-column" className="text-sm">
          Biological Sample Column
        </Label>
        <Select value={metadataColumn} onValueChange={onMetadataColumnChange}>
          <SelectTrigger id="metadata-column">
            <SelectValue placeholder="Select column..." />
          </SelectTrigger>
          <SelectContent>
            {metadataColumns.map((column) => (
              <SelectItem key={column} value={column}>
                {column}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Select the metadata column that contains the biological sample ID
          (samples with the same value are repetitions).
        </p>
      </div>
    );
  }

  if (method !== 'pattern') {
    return null;
  }

  return (
    <div className="space-y-3">
      <Label className="text-sm">Pattern Template</Label>
      <RadioGroup
        value={String(selectedPreset)}
        onValueChange={(value) => onPresetChange(Number(value))}
        className="space-y-2"
      >
        {COMMON_REPETITION_PATTERNS.map((preset, index) => (
          <Label
            key={index}
            className={cn(
              'flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors',
              selectedPreset === index
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/30',
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

      {selectedPreset === CUSTOM_REPETITION_PATTERN_INDEX && (
        <div className="space-y-2 mt-3">
          <Label htmlFor="custom-pattern" className="text-sm">
            Custom Regex Pattern
          </Label>
          <Input
            id="custom-pattern"
            value={customPattern}
            onChange={(event) => onCustomPatternChange(event.target.value)}
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
  );
}

interface RepetitionDistanceMetricSelectProps {
  distanceMetric: RepetitionDistanceMetric;
  onDistanceMetricChange: (metric: RepetitionDistanceMetric) => void;
}

export function RepetitionDistanceMetricSelect({
  distanceMetric,
  onDistanceMetricChange,
}: RepetitionDistanceMetricSelectProps) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Distance Metric</Label>
      <Select
        value={distanceMetric}
        onValueChange={(value) => onDistanceMetricChange(value as RepetitionDistanceMetric)}
      >
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
  );
}

interface RepetitionPreviewPanelProps {
  detectedGroups: DetectedRepetitionGroup[];
  summary: RepetitionDetectionSummary;
  sampleCount: number;
  previewLimit?: number;
}

export function RepetitionPreviewPanel({
  detectedGroups,
  summary,
  sampleCount,
  previewLimit = 20,
}: RepetitionPreviewPanelProps) {
  const previewGroups = detectedGroups.slice(0, previewLimit);
  const hiddenGroupCount = Math.max(0, summary.bioSamples - previewGroups.length);

  return (
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
        {previewGroups.length > 0 ? (
          <div className="p-2 space-y-1.5">
            {previewGroups.map((group) => (
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
            {hiddenGroupCount > 0 && (
              <p className="text-xs text-muted-foreground text-center py-1">
                ... and {hiddenGroupCount} more groups
              </p>
            )}
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            {sampleCount === 0
              ? 'Load a dataset to preview detection'
              : 'No repetitions found with current settings'}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
