import { Box, Download, MousePointer2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Tooltip as TooltipUI,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface DimensionReductionToolbarActionsProps {
  canToggle3d: boolean;
  is3d: boolean;
  enableHover: boolean;
  onToggleViewMode: () => void;
  onToggleHover: () => void;
  onExport: () => void;
}

export function DimensionReductionToolbarActions({
  canToggle3d,
  is3d,
  enableHover,
  onToggleViewMode,
  onToggleHover,
  onExport,
}: DimensionReductionToolbarActionsProps) {
  return (
    <>
      {canToggle3d && (
        <TooltipProvider delayDuration={200}>
          <TooltipUI>
            <TooltipTrigger asChild>
              <Button
                variant={is3d ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-2"
                onClick={onToggleViewMode}
              >
                <Box className="w-3 h-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">{is3d ? '2D View' : '3D View'}</p>
            </TooltipContent>
          </TooltipUI>
        </TooltipProvider>
      )}

      <TooltipProvider delayDuration={200}>
        <TooltipUI>
          <TooltipTrigger asChild>
            <Button
              variant={enableHover ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 px-2"
              onClick={onToggleHover}
            >
              <MousePointer2 className={cn('w-3.5 h-3.5', enableHover && 'text-primary')} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="text-xs">{enableHover ? 'Hover enabled' : 'Hover disabled'}</p>
          </TooltipContent>
        </TooltipUI>
      </TooltipProvider>

      <TooltipProvider delayDuration={200}>
        <TooltipUI>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onExport}>
              <Download className="w-3 h-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="text-xs">Export chart</p>
          </TooltipContent>
        </TooltipUI>
      </TooltipProvider>
    </>
  );
}
