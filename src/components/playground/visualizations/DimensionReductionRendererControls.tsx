import { Cpu, Monitor, Zap } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Tooltip as TooltipUI,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { ScatterRendererType } from './scatter';

export interface DimensionReductionRendererControlsProps {
  rendererType: ScatterRendererType;
  onRendererTypeChange: (rendererType: ScatterRendererType) => void;
}

export function DimensionReductionRendererControls({
  rendererType,
  onRendererTypeChange,
}: DimensionReductionRendererControlsProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-center border rounded-md">
        <TooltipUI>
          <TooltipTrigger asChild>
            <Button
              variant={rendererType === 'recharts' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 w-7 p-0 rounded-r-none border-r"
              onClick={() => onRendererTypeChange('recharts')}
            >
              <Monitor className="w-3.5 h-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="text-xs">SVG renderer (Recharts)</p>
          </TooltipContent>
        </TooltipUI>

        <TooltipUI>
          <TooltipTrigger asChild>
            <Button
              variant={rendererType === 'webgl' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => onRendererTypeChange('webgl')}
            >
              <Zap className={`w-3.5 h-3.5 ${rendererType === 'webgl' ? 'text-yellow-500' : ''}`} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="text-xs">Pure WebGL (GPU accelerated)</p>
          </TooltipContent>
        </TooltipUI>

        <TooltipUI>
          <TooltipTrigger asChild>
            <Button
              variant={rendererType === 'regl' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 w-7 p-0 rounded-l-none border-l"
              onClick={() => onRendererTypeChange('regl')}
            >
              <Cpu className={`w-3.5 h-3.5 ${rendererType === 'regl' ? 'text-yellow-500' : ''}`} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="text-xs">Regl renderer (GPU accelerated)</p>
          </TooltipContent>
        </TooltipUI>
      </div>
    </TooltipProvider>
  );
}
