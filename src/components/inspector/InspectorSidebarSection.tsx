import { useState, type ComponentType, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, HelpCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface InspectorSidebarSectionProps {
  icon: ComponentType<{ className?: string }>;
  title: string;
  badge?: ReactNode;
  help?: string;
  actions?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function InspectorSidebarSection({
  icon: Icon,
  title,
  badge,
  help,
  actions,
  defaultOpen = true,
  children,
}: InspectorSidebarSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl border border-border/60 bg-background/80 shadow-sm">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-t-xl px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
        onClick={() => setOpen(!open)}
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/80">
          {title}
        </span>
        {badge}
        {actions}
        {help ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                role="button"
                tabIndex={-1}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={e => e.stopPropagation()}
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-[220px] text-xs leading-5">
              {help}
            </TooltipContent>
          </Tooltip>
        ) : null}
        {open
          ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        }
      </button>
      {open && (
        <div className="animate-in fade-in slide-in-from-top-1 px-3 pb-3 pt-1 duration-150">
          {children}
        </div>
      )}
    </div>
  );
}
