import { useCallback, memo, useMemo } from 'react';
import { Paintbrush, Palette } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  type GlobalColorConfig,
  type GlobalColorMode,
  type ContinuousPalette,
  type CategoricalPalette,
  type ColorContext,
  CATEGORICAL_PALETTES,
  getContinuousPaletteLabel,
  getCategoricalPaletteLabel,
  getColorModeLabel,
  getContinuousPaletteGradient,
  isContinuousMode,
} from '@/lib/playground/colorConfig';
import type { TargetType } from '@/lib/playground/targetTypeDetection';
import { RibbonGroup } from './CanvasToolbarRibbonGroup';

interface ColorModeSelectorProps {
  colorConfig: GlobalColorConfig;
  onChange: (config: GlobalColorConfig) => void;
  hasFolds: boolean;
  hasPartition: boolean;
  hasOutliers: boolean;
  metadataColumns: string[];
  colorContext?: ColorContext;
}

const ColorModeSelector = memo(function ColorModeSelector({
  colorConfig,
  onChange,
  hasFolds,
  hasPartition,
  hasOutliers: _hasOutliers,
  metadataColumns,
  colorContext,
}: ColorModeSelectorProps) {
  const hasMetadata = metadataColumns.length > 0;
  const detectedTargetType = colorContext?.targetType;

  const showContinuousPalette = isContinuousMode(
    colorConfig.mode,
    colorConfig.metadataType,
    detectedTargetType,
    colorConfig.targetTypeOverride
  );

  const continuousPaletteOptions: ContinuousPalette[] = [
    'blue_red', 'viridis', 'plasma', 'inferno', 'coolwarm', 'spectral',
    'cividis', 'winter', 'blues', 'greens', 'turbo'
  ];
  const categoricalPaletteOptions: CategoricalPalette[] = ['default', 'tableau10', 'set1', 'set2', 'paired'];

  return (
    <div className="flex items-center gap-1">
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Palette className="w-3 h-3 text-muted-foreground cursor-help" />
          </TooltipTrigger>
          <TooltipContent side="bottom">Color mode: how samples are colored</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Select
        value={colorConfig.mode}
        onValueChange={(mode) => onChange({
          ...colorConfig,
          mode: mode as GlobalColorMode,
          metadataKey: mode === 'metadata' ? colorConfig.metadataKey : undefined,
        })}
      >
        <SelectTrigger className="h-6 w-28 text-[10px]">
          <SelectValue>{getColorModeLabel(colorConfig.mode)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="target">By Y Value</SelectItem>
          <SelectItem value="partition" disabled={!hasPartition}>By Partition</SelectItem>
          <SelectItem value="fold" disabled={!hasFolds}>By Fold</SelectItem>
          <SelectItem value="metadata" disabled={!hasMetadata}>By Metadata</SelectItem>
          <SelectItem value="selection">By Selection</SelectItem>
          <SelectItem value="outlier">By Outlier</SelectItem>
        </SelectContent>
      </Select>

      {colorConfig.mode === 'metadata' && hasMetadata && (
        <Select
          value={colorConfig.metadataKey || metadataColumns[0]}
          onValueChange={(key) => onChange({ ...colorConfig, metadataKey: key })}
        >
          <SelectTrigger className="h-6 w-24 text-[10px]">
            <SelectValue placeholder="Column..." />
          </SelectTrigger>
          <SelectContent>
            {metadataColumns.map(col => (
              <SelectItem key={col} value={col}>{col}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
            <Palette className="w-3 h-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {colorConfig.mode === 'target' && (
            <>
              <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                Target Type
                {detectedTargetType && (
                  <span className="ml-1 text-muted-foreground/70">
                    (detected: {detectedTargetType})
                  </span>
                )}
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={colorConfig.targetTypeOverride ?? 'auto'}
                onValueChange={(value) => onChange({
                  ...colorConfig,
                  targetTypeOverride: value as TargetType | 'auto',
                })}
              >
                <DropdownMenuRadioItem value="auto">
                  <span className="text-xs">Auto-detect</span>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="regression">
                  <span className="text-xs">Force Regression (continuous)</span>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="classification">
                  <span className="text-xs">Force Classification (categorical)</span>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="ordinal">
                  <span className="text-xs">Force Ordinal (rating scale)</span>
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
            </>
          )}

          {showContinuousPalette ? (
            <>
              <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                Continuous Palette
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={colorConfig.continuousPalette}
                onValueChange={(value) => onChange({ ...colorConfig, continuousPalette: value as ContinuousPalette })}
              >
                {continuousPaletteOptions.map(palette => (
                  <DropdownMenuRadioItem key={palette} value={palette} className="flex items-center gap-2">
                    <div
                      className="w-16 h-3 rounded-sm"
                      style={{ background: getContinuousPaletteGradient(palette) }}
                    />
                    <span className="text-xs">{getContinuousPaletteLabel(palette)}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </>
          ) : (
            <>
              <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                Categorical Palette
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={colorConfig.categoricalPalette}
                onValueChange={(value) => onChange({ ...colorConfig, categoricalPalette: value as CategoricalPalette })}
              >
                {categoricalPaletteOptions.map(palette => (
                  <DropdownMenuRadioItem key={palette} value={palette} className="flex items-center gap-2">
                    <div className="flex gap-0.5">
                      {CATEGORICAL_PALETTES[palette].slice(0, 5).map((color, i) => (
                        <div
                          key={i}
                          className="w-3 h-3 rounded-sm"
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                    <span className="text-xs">{getCategoricalPaletteLabel(palette)}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});
export interface CanvasToolbarColorGroupProps {
  colorConfig: GlobalColorConfig;
  onColorConfigChange: (config: GlobalColorConfig) => void;
  onInteractionStart: () => void;
  hasFolds: boolean;
  hasPartition: boolean;
  hasOutliers: boolean;
  metadata?: Record<string, unknown[]>;
  colorContext?: ColorContext;
}

export const CanvasToolbarColorGroup = memo(function CanvasToolbarColorGroup({
  colorConfig,
  onColorConfigChange,
  onInteractionStart,
  hasFolds,
  hasPartition,
  hasOutliers,
  metadata,
  colorContext,
}: CanvasToolbarColorGroupProps) {
  const metadataColumns = useMemo(() => {
    if (!metadata) return [];
    return Object.keys(metadata).filter(key => {
      const values = metadata[key];
      return Array.isArray(values) && values.length > 0;
    });
  }, [metadata]);

  const handleColorConfigChange = useCallback((config: GlobalColorConfig) => {
    onInteractionStart();
    onColorConfigChange(config);
  }, [onInteractionStart, onColorConfigChange]);

  return (
    <RibbonGroup label="Coloration" icon={<Paintbrush className="w-2.5 h-2.5" />}>
      <ColorModeSelector
        colorConfig={colorConfig}
        onChange={handleColorConfigChange}
        hasFolds={hasFolds}
        hasPartition={hasPartition}
        hasOutliers={hasOutliers}
        metadataColumns={metadataColumns}
        colorContext={colorContext}
      />
    </RibbonGroup>
  );
});
