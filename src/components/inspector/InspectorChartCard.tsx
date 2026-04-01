import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface InspectorChartCardProps {
  title: string;
  description?: string;
  badge?: ReactNode;
  actions?: ReactNode;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
}

export function InspectorChartCard({
  title,
  description,
  badge,
  actions,
  className,
  contentClassName,
  children,
}: InspectorChartCardProps) {
  return (
    <Card className={cn("border-border/60 shadow-sm", className)}>
      <CardHeader className="space-y-2 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-sm font-semibold">{title}</CardTitle>
            {description ? (
              <CardDescription className="mt-1 text-xs leading-5">{description}</CardDescription>
            ) : null}
          </div>
          {(badge || actions) ? (
            <div className="flex items-center gap-2">
              {badge}
              {actions}
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className={cn("px-4 pb-4 pt-0", contentClassName)}>
        {children}
      </CardContent>
    </Card>
  );
}
