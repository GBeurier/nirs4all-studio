import { AlertCircle, AlertTriangle, ChevronDown, ChevronUp, Eye, EyeOff, Filter, GripVertical, Grid3X3, HelpCircle, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import type { UnifiedOperatorFilterStats } from './UnifiedOperatorCardTypes';
import { getFilterStatsBadgeViewModel } from './UnifiedOperatorCardViewData';

interface UnifiedOperatorCardHeaderProps {
  index: number;
  displayName: string;
  description?: string;
  isFilter: boolean;
  isSplitter: boolean;
  hasError: boolean;
  filterStats?: UnifiedOperatorFilterStats;
  enabled: boolean;
  hasParams: boolean;
  isExpanded: boolean;
  onOpenError: () => void;
  onToggleEnabled: () => void;
  onToggleExpanded: () => void;
  onRemove: () => void;
}

export function UnifiedOperatorCardHeader({
  index,
  displayName,
  description,
  isFilter,
  isSplitter,
  hasError,
  filterStats,
  enabled,
  hasParams,
  isExpanded,
  onOpenError,
  onToggleEnabled,
  onToggleExpanded,
  onRemove,
}: UnifiedOperatorCardHeaderProps) {
  const filterStatsBadge = getFilterStatsBadgeViewModel({ isFilter, filterStats });

  return (
    <div className="flex items-center gap-1 p-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="cursor-grab hover:text-primary">
            <GripVertical className="w-4 h-4 text-muted-foreground" />
          </div>
        </TooltipTrigger>
        <TooltipContent side="left">Drag to reorder</TooltipContent>
      </Tooltip>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono text-muted-foreground">{index + 1}</span>
          {isFilter && (
            <Filter className="w-3 h-3 text-red-500" />
          )}
          {isSplitter && (
            <Grid3X3 className="w-3 h-3 text-orange-500" />
          )}
          <span className="text-xs font-medium text-foreground truncate">
            {displayName}
          </span>
          {description && (
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="w-3 h-3 text-muted-foreground hover:text-primary cursor-help flex-shrink-0" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                <p className="text-xs">{description}</p>
              </TooltipContent>
            </Tooltip>
          )}
          {hasError && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenError();
                  }}
                  className="inline-flex items-center gap-0.5 h-4 px-1.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-medium leading-none hover:bg-destructive/90 focus:outline-none focus:ring-1 focus:ring-destructive/40 cursor-pointer flex-shrink-0"
                >
                  <AlertTriangle className="w-2.5 h-2.5 flex-shrink-0" />
                  <span>Failed</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                <p className="text-xs">Click to view error log</p>
              </TooltipContent>
            </Tooltip>
          )}
          {filterStatsBadge && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant={filterStatsBadge.variant}
                  className={filterStatsBadge.className}
                >
                  <AlertCircle className="w-2.5 h-2.5" />
                  {filterStatsBadge.label}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                <p className="text-xs">{filterStatsBadge.tooltip}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      <div className="flex items-center gap-0.5 flex-shrink-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={onToggleEnabled}
            >
              {enabled ? (
                <Eye className="w-3.5 h-3.5" />
              ) : (
                <EyeOff className="w-3.5 h-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {enabled ? 'Disable step' : 'Enable step'}
          </TooltipContent>
        </Tooltip>

        {hasParams && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                onClick={onToggleExpanded}
              >
                {isExpanded ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {isExpanded ? 'Hide parameters' : 'Show parameters'}
            </TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={onRemove}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Remove step</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
