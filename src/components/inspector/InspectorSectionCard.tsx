import type { ReactNode } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface InspectorSectionCardProps {
  title: string;
  description?: string;
  headerRight?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function InspectorSectionCard({
  title,
  description,
  headerRight,
  children,
  className,
  contentClassName,
}: InspectorSectionCardProps) {
  return (
    <Card className={cn("border-border/60 shadow-sm", className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-4">
        <div className="space-y-1">
          <CardTitle className="text-base">{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {headerRight ? <div className="shrink-0">{headerRight}</div> : null}
      </CardHeader>
      <CardContent className={cn("pt-0", contentClassName)}>{children}</CardContent>
    </Card>
  );
}
