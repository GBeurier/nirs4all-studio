/**
 * ColorLegend - Dynamic legend component for playground color modes
 *
 * Renders:
 * - Gradient bar + min/max labels for continuous modes (target, index, metadata-continuous)
 * - Color swatches + labels for categorical modes (partition, fold, metadata-categorical, selection, outlier)
 */

import { memo, useMemo } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  type GlobalColorConfig,
  type ColorContext,
  isContinuousMode,
  getContinuousPaletteGradient,
  getCategoricalColor,
  PARTITION_COLORS,
  HIGHLIGHT_COLORS_CONCRETE,
  getColorModeLabel,
  getEffectiveTargetType,
} from '@/lib/playground/colorConfig';
import { isCategoricalTarget } from '@/lib/playground/targetTypeDetection';

export interface ColorLegendProps {
  config: GlobalColorConfig;
  context: ColorContext;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  className?: string;
}

interface LegendItem {
  color: string;
  label: string;
}

/**
 * Get legend items for categorical modes
 */
function getCategoricalLegendItems(
  config: GlobalColorConfig,
  context: ColorContext
): LegendItem[] {
  // Phase 5: Get effective target type considering override
  const effectiveTargetType = getEffectiveTargetType(context.targetType, config.targetTypeOverride);

  switch (config.mode) {
    case 'target': {
      // Phase 5: Classification mode - show class swatches
      if (effectiveTargetType && isCategoricalTarget(effectiveTargetType)) {
        const classLabels = context.classLabels ?? [];
        return classLabels.slice(0, 10).map((label, idx) => ({
          color: getCategoricalColor(idx, config.categoricalPalette),
          label: label,
        }));
      }
      return [];
    }

    case 'partition':
      return [
        { color: PARTITION_COLORS.train, label: 'Train' },
        { color: PARTITION_COLORS.test, label: 'Test' },
      ];

    case 'fold': {
      if (!context.foldLabels) return [];
      const uniqueFolds = [...new Set(context.foldLabels)].filter(f => f >= 0).sort((a, b) => a - b);
      return uniqueFolds.map(fold => ({
        color: getCategoricalColor(fold, config.categoricalPalette),
        label: `Fold ${fold + 1}`,
      }));
    }

    case 'metadata': {
      if (!config.metadataKey || !context.metadata) return [];
      const values = context.metadata[config.metadataKey];
      if (!values) return [];
      const uniqueValues = [...new Set(values.filter(v => v !== null && v !== undefined))];
      return uniqueValues.slice(0, 10).map((value, idx) => ({
        color: getCategoricalColor(idx, config.categoricalPalette),
        label: String(value),
      }));
    }

    case 'selection':
      // Use concrete colors for legend swatches (CSS variables don't work in inline styles)
      return [
        { color: HIGHLIGHT_COLORS_CONCRETE.selected, label: 'Selected' },
        { color: HIGHLIGHT_COLORS_CONCRETE.unselected, label: 'Unselected' },
      ];

    case 'outlier':
      return [
        { color: HIGHLIGHT_COLORS_CONCRETE.outlier, label: 'Outlier' },
        { color: HIGHLIGHT_COLORS_CONCRETE.unselected, label: 'Normal' },
      ];

    default:
      return [];
  }
}

/**
 * Get min/max labels for continuous modes
 */
function getContinuousRange(
  config: GlobalColorConfig,
  context: ColorContext
): { min: string; max: string } | null {
  switch (config.mode) {
    case 'target':
      if (context.yMin === undefined || context.yMax === undefined) return null;
      return {
        min: context.yMin.toFixed(2),
        max: context.yMax.toFixed(2),
      };

    case 'index':
      return {
        min: '0',
        max: String((context.totalSamples ?? context.y?.length ?? 1) - 1),
      };

    case 'metadata': {
      if (!config.metadataKey || !context.metadata) return null;
      const values = context.metadata[config.metadataKey];
      if (!values) return null;
      const numericValues = values.filter(v => typeof v === 'number') as number[];
      if (numericValues.length === 0) return null;
      const min = Math.min(...numericValues);
      const max = Math.max(...numericValues);
      return {
        min: min.toFixed(2),
        max: max.toFixed(2),
      };
    }

    default:
      return null;
  }
}

/**
 * Gradient legend for continuous color modes
 */
const GradientLegend = memo(function GradientLegend({
  config,
  context,
}: {
  config: GlobalColorConfig;
  context: ColorContext;
}) {
  const range = getContinuousRange(config, context);
  const gradient = getContinuousPaletteGradient(config.continuousPalette);

  return (
    <div className="flex flex-col gap-1">
      <div
        className="h-3 w-full rounded-sm"
        style={{ background: gradient }}
      />
      {range && (
        <div className="flex justify-between text-[9px] text-muted-foreground">
          <span>{range.min}</span>
          <span>{range.max}</span>
        </div>
      )}
    </div>
  );
});

/**
 * Swatch legend for categorical color modes
 */
const SwatchLegend = memo(function SwatchLegend({
  items,
}: {
  items: LegendItem[];
}) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {items.map((item, idx) => (
        <div key={idx} className="flex items-center gap-1.5">
          <div
            className="w-3 h-3 rounded-sm shrink-0"
            style={{ backgroundColor: item.color }}
          />
          <span className="text-[9px] text-muted-foreground truncate max-w-[60px]">
            {item.label}
          </span>
        </div>
      ))}
    </div>
  );
});

/**
 * Main ColorLegend component
 */
export const ColorLegend = memo(function ColorLegend({
  config,
  context,
  collapsed = false,
  onToggleCollapse,
  className,
}: ColorLegendProps) {
  // Phase 5: Pass targetType and override to determine if target mode is continuous or categorical
  const isContinuous = useMemo(
    () => isContinuousMode(config.mode, config.metadataType, context.targetType, config.targetTypeOverride),
    [config.mode, config.metadataType, context.targetType, config.targetTypeOverride]
  );

  // Get effective target type for legend
  const effectiveTargetType = useMemo(
    () => getEffectiveTargetType(context.targetType, config.targetTypeOverride),
    [context.targetType, config.targetTypeOverride]
  );

  const categoricalItems = useMemo(
    () => (isContinuous ? [] : getCategoricalLegendItems(config, context)),
    [isContinuous, config, context]
  );

  // Phase 5: Show "Class" label for classification target mode
  const modeLabel = useMemo(() => {
    if (config.mode === 'target' && effectiveTargetType && isCategoricalTarget(effectiveTargetType)) {
      return 'Class';
    }
    return getColorModeLabel(config.mode);
  }, [config.mode, effectiveTargetType]);

  // Don't render if nothing to show
  if (!isContinuous && categoricalItems.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        'bg-card border rounded-lg shadow-sm',
        'transition-all duration-200',
        collapsed ? 'w-auto' : 'min-w-[120px] max-w-[200px]',
        className
      )}
    >
      {/* Header with collapse toggle */}
      <div
        className={cn(
          'flex items-center justify-between gap-2 px-2 py-1.5',
          !collapsed && 'border-b'
        )}
      >
        <span className="text-[10px] font-medium text-foreground truncate">
          {modeLabel}
        </span>
        {onToggleCollapse && (
          <Button
            variant="ghost"
            size="sm"
            className="h-4 w-4 p-0"
            onClick={onToggleCollapse}
          >
            {collapsed ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
          </Button>
        )}
      </div>

      {/* Legend content */}
      {!collapsed && (
        <div className="px-2 py-1.5">
          {isContinuous ? (
            <GradientLegend config={config} context={context} />
          ) : (
            <SwatchLegend items={categoricalItems} />
          )}
        </div>
      )}
    </div>
  );
});

/**
 * InlineColorLegend - Simplified legend for embedding in charts
 * Shows just colors and labels, no title or border
 */
export interface InlineColorLegendProps {
  config: GlobalColorConfig;
  context: ColorContext;
  className?: string;
}

export const InlineColorLegend = memo(function InlineColorLegend({
  config,
  context,
  className,
}: InlineColorLegendProps) {
  const isContinuous = useMemo(
    () => isContinuousMode(config.mode, config.metadataType, context.targetType, config.targetTypeOverride),
    [config.mode, config.metadataType, context.targetType, config.targetTypeOverride]
  );

  const categoricalItems = useMemo(
    () => (isContinuous ? [] : getCategoricalLegendItems(config, context)),
    [isContinuous, config, context]
  );

  // Don't render if nothing to show
  if (!isContinuous && categoricalItems.length === 0) {
    return null;
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {isContinuous ? (
        <GradientLegend config={config} context={context} />
      ) : (
        <SwatchLegend items={categoricalItems} />
      )}
    </div>
  );
});

export default ColorLegend;
