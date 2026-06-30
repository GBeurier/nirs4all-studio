import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface InspectorPaletteButtonProps {
  active: boolean;
  onClick: () => void;
  label: string;
  description: string;
  children: ReactNode;
}

export function InspectorPaletteButton({
  active,
  onClick,
  label,
  description,
  children,
}: InspectorPaletteButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={active ? 'secondary' : 'outline'}
          className={cn(
            'h-auto w-full justify-start gap-3 px-2.5 py-2 text-left',
            active && 'border-primary/40 bg-primary/10',
          )}
          onClick={onClick}
        >
          {children}
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-foreground">{label}</div>
            <div className="truncate text-[10px] text-muted-foreground">{description}</div>
          </div>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-[220px] text-xs leading-5">
        {description}
      </TooltipContent>
    </Tooltip>
  );
}
