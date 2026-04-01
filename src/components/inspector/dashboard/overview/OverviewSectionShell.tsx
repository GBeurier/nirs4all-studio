import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export interface OverviewSectionShellProps {
  title: string;
  description?: string;
  kicker?: string;
  badge?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  compact?: boolean;
}

export function OverviewSectionShell({
  title,
  description,
  kicker = "Overview",
  badge,
  actions,
  footer,
  children,
  className,
  contentClassName,
  compact = false,
}: OverviewSectionShellProps) {
  return (
    <Card className={cn(
      "overflow-hidden border-border/60 shadow-sm",
      "bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.08),_transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent)]",
      className,
    )}>
      <CardHeader className={cn("space-y-3", compact ? "px-4 py-4" : "px-5 py-5")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-border/60 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {kicker}
              </Badge>
              <ChevronRight className="h-3 w-3 text-muted-foreground/70" />
              <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Guided comparison
              </span>
            </div>
            <CardTitle className={cn("text-base font-semibold", compact && "text-sm")}>
              {title}
            </CardTitle>
            {description ? (
              <CardDescription className="max-w-3xl text-xs leading-5">
                {description}
              </CardDescription>
            ) : null}
          </div>

          {(badge || actions) ? (
            <div className="flex flex-wrap items-center gap-2">
              {badge}
              {actions}
            </div>
          ) : null}
        </div>
      </CardHeader>

      <Separator />

      <CardContent className={cn("space-y-4", compact ? "px-4 py-4" : "px-5 py-5", contentClassName)}>
        {children}
      </CardContent>

      {footer ? (
        <>
          <Separator />
          <div className={cn("px-4 py-3 text-xs text-muted-foreground", compact ? "px-4" : "px-5")}>
            {footer}
          </div>
        </>
      ) : null}
    </Card>
  );
}
