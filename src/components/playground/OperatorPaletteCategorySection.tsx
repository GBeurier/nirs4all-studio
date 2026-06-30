import type { ComponentType, ReactNode } from 'react';
import {
  ChevronRight,
  Filter,
  GitBranch,
  Grid3X3,
  Layers,
  Maximize2,
  Minus,
  Plus,
  Ruler,
  Scaling,
  Scissors,
  Shield,
  Shuffle,
  Target,
  TrendingDown,
  TrendingUp,
  Waves,
  XCircle,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { OperatorDefinition } from '@/types/playground';
import {
  getOperatorCategoryLabel,
  getOperatorKey,
  type PlaygroundTabType,
} from '@/lib/playground/operatorPaletteData';

// Icon mapping for operator categories (case-insensitive lookup via normalized key)
const ICON_MAP: Record<string, ComponentType<{ className?: string }>> = {
  // Preprocessing categories (from NodeRegistry JSON definitions)
  'nirs core': Waves,
  baseline: Minus,
  smoothing: TrendingUp,
  scaling: Scaling,
  normalization: Scaling,
  derivatives: TrendingUp,
  wavelet: Layers,
  wavelets: Layers,
  conversion: TrendingDown,
  'feature selection': Scissors,
  'feature ops': Scissors,
  features: Scissors,
  'dimensionality reduction': Maximize2,
  // sklearn preprocessing subcategories
  'scikit-scalers': Scaling,
  'scikit-dimensionality': Maximize2,
  'scikit-encoding': Layers,
  'scikit-imputation': Shield,
  'scikit-feature-selection': Scissors,
  'scikit-feature-extraction': Scissors,
  'scikit-kernel-projection': Maximize2,
  'scikit-meta-transformers': Layers,
  'scikit-misc-transformers': GitBranch,
  'scikit-cluster-neighbors': Target,
  'signal-conversion': TrendingDown,
  'spectral-transforms': Waves,
  'feature-engineering': Scissors,
  'feature-selection': Scissors,
  // Legacy backend keys
  scatter_correction: Waves,
  derivative: TrendingUp,
  wavelet_single: Layers,
  // Augmentation categories
  noise: Waves,
  scattering: Waves,
  environmental: Zap,
  'edge artifacts': Zap,
  spectral: Waves,
  spline: TrendingUp,
  synthesis: Layers,
  wavelength: Maximize2,
  random: Shuffle,
  mixing: Shuffle,
  // Splitting categories
  nirs: Ruler,
  sklearn: Grid3X3,
  'sklearn-splitters': Grid3X3,
  // Filter categories
  outlier: XCircle,
  quality: Shield,
  selection: Filter,
  metadata: Layers,
  // Fallback
  other: GitBranch,
};

function getOperatorIcon(category: string): ComponentType<{ className?: string }> {
  return ICON_MAP[category.toLowerCase()] || Waves;
}

function getOperatorTypeAccentColor(type: PlaygroundTabType): string {
  switch (type) {
    case 'augmentation':
      return 'text-blue-500';
    case 'splitting':
      return 'text-orange-500';
    case 'filter':
      return 'text-red-500';
    case 'preprocessing':
      return 'text-primary';
  }
}

interface OperatorPaletteCategoryIconProps {
  category: string;
  type: PlaygroundTabType;
  className?: string;
}

export function OperatorPaletteCategoryIcon({
  category,
  type,
  className,
}: OperatorPaletteCategoryIconProps) {
  const Icon = getOperatorIcon(category);

  return <Icon className={cn(className, getOperatorTypeAccentColor(type))} />;
}

interface OperatorPaletteCategorySectionProps {
  category: string;
  type: PlaygroundTabType;
  operators: OperatorDefinition[];
  isExpanded: boolean;
  onToggle: () => void;
  onSelect: (op: OperatorDefinition) => void;
}

export function OperatorPaletteCategorySection({
  category,
  type,
  operators,
  isExpanded,
  onToggle,
  onSelect,
}: OperatorPaletteCategorySectionProps) {
  const label = getOperatorCategoryLabel(category);

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors">
          <ChevronRight
            className={cn(
              'w-3.5 h-3.5 transition-transform',
              isExpanded && 'rotate-90'
            )}
          />
          <OperatorPaletteCategoryIcon category={category} type={type} className="w-3.5 h-3.5" />
          <span>{label}</span>
          <span className="ml-auto text-[10px] opacity-60">{operators.length}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-1 pt-1 pb-2 pl-5">
          <TooltipProvider delayDuration={300}>
            {operators.map((op) => (
              <OperatorTooltip key={getOperatorKey(op)} operator={op}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto py-1.5 px-2 flex flex-row items-center gap-2 hover:bg-muted justify-start relative w-full"
                  onClick={() => onSelect(op)}
                >
                  <OperatorPaletteCategoryIcon category={category} type={type} className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-[10px] font-medium leading-tight text-left line-clamp-1">
                    {op.display_name}
                  </span>
                </Button>
              </OperatorTooltip>
            ))}
          </TooltipProvider>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface OperatorTooltipProps {
  operator: OperatorDefinition;
  children: ReactNode;
}

function OperatorTooltip({ operator, children }: OperatorTooltipProps) {
  const paramCount = Object.keys(operator.params).filter(k => !k.startsWith('_')).length;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {children}
      </TooltipTrigger>
      <TooltipContent
        side="right"
        align="start"
        className="max-w-xs p-3 bg-popover text-popover-foreground border shadow-lg"
      >
        <div className="space-y-2">
          <div>
            <div className="font-semibold text-sm">{operator.display_name}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {operator.description}
            </div>
          </div>

          {paramCount > 0 && (
            <div className="pt-1 border-t border-border">
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
                Parameters
              </div>
              <div className="space-y-0.5">
                {Object.entries(operator.params)
                  .filter(([key]) => !key.startsWith('_'))
                  .slice(0, 4)
                  .map(([key, info]) => (
                    <div key={key} className="flex items-center gap-1 text-[11px]">
                      <code className="text-xs bg-muted px-1 rounded">{key}</code>
                      {info.required && (
                        <span className="text-destructive text-[10px]">*</span>
                      )}
                      {info.default !== undefined && !info.default_is_callable && (
                        <span className="text-muted-foreground">
                          = {formatDefaultValue(info.default)}
                        </span>
                      )}
                    </div>
                  ))}
                {paramCount > 4 && (
                  <div className="text-[10px] text-muted-foreground">
                    +{paramCount - 4} more...
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="pt-1 border-t border-border text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Plus className="w-2.5 h-2.5" />
              Click to add to pipeline
            </span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function formatDefaultValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return `"${value}"`;
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === 'object') return '{...}';
  return String(value);
}
