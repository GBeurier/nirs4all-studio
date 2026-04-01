import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface DiagnosticsSectionProps {
  title: string;
  description?: string;
  summary?: string;
  badges?: Array<{ label: string; tone?: "default" | "secondary" | "outline" }>;
  toolbar?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function DiagnosticsSection({
  title,
  description,
  summary,
  badges,
  toolbar,
  children,
  className,
  contentClassName,
}: DiagnosticsSectionProps) {
  return (
    <Card className={cn("overflow-hidden border-border/70 bg-card/90 shadow-sm", className)}>
      <CardHeader className="space-y-3 border-b border-border/50 bg-gradient-to-r from-background to-muted/30 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="text-base font-semibold tracking-tight">{title}</CardTitle>
            {description ? <CardDescription className="max-w-2xl text-xs">{description}</CardDescription> : null}
          </div>
          {toolbar ? <div className="flex shrink-0 items-center gap-2">{toolbar}</div> : null}
        </div>

        {(summary || (badges && badges.length > 0)) && (
          <div className="flex flex-wrap items-center gap-2">
            {summary ? <Badge variant="secondary">{summary}</Badge> : null}
            {badges?.map(badge => (
              <Badge key={badge.label} variant={badge.tone ?? "outline"}>
                {badge.label}
              </Badge>
            ))}
          </div>
        )}
      </CardHeader>

      <CardContent className={cn("p-4", contentClassName)}>
        {children}
      </CardContent>
    </Card>
  );
}
