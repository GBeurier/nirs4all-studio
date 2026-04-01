import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface OverviewSummaryCardItem {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: LucideIcon;
  tone?: "neutral" | "positive" | "warning" | "danger";
}

export interface OverviewSummaryCardsProps {
  items: OverviewSummaryCardItem[];
  className?: string;
  columns?: 2 | 3 | 4;
}

const toneStyles: Record<NonNullable<OverviewSummaryCardItem["tone"]>, string> = {
  neutral: "border-border/60 bg-card/80",
  positive: "border-emerald-500/20 bg-emerald-500/8",
  warning: "border-amber-500/20 bg-amber-500/8",
  danger: "border-rose-500/20 bg-rose-500/8",
};

const badgeStyles: Record<NonNullable<OverviewSummaryCardItem["tone"]>, string> = {
  neutral: "border-border/60 text-muted-foreground",
  positive: "border-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  warning: "border-amber-500/20 text-amber-700 dark:text-amber-300",
  danger: "border-rose-500/20 text-rose-700 dark:text-rose-300",
};

export function OverviewSummaryCards({
  items,
  className,
  columns = 4,
}: OverviewSummaryCardsProps) {
  return (
    <div className={cn(
      "grid gap-3",
      columns === 2 && "md:grid-cols-2",
      columns === 3 && "md:grid-cols-2 xl:grid-cols-3",
      columns === 4 && "md:grid-cols-2 xl:grid-cols-4",
      className,
    )}>
      {items.map((item) => {
        const Icon = item.icon;
        const tone = item.tone ?? "neutral";

        return (
          <Card key={item.label} className={cn("shadow-sm", toneStyles[tone])}>
            <CardContent className="flex items-start gap-3 p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/50 bg-background/75">
                {Icon ? <Icon className="h-4 w-4 text-muted-foreground" /> : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {item.label}
                </div>
                <div className="mt-1 truncate text-2xl font-semibold leading-tight text-foreground">
                  {item.value}
                </div>
                {item.detail ? (
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">
                    {item.detail}
                  </div>
                ) : null}
              </div>
              <Badge variant="outline" className={cn("mt-0.5 shrink-0 text-[10px] uppercase tracking-wide", badgeStyles[tone])}>
                {tone}
              </Badge>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
