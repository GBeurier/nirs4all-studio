import { BarChart3, Target, TrendingUp, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResultMetricCardData, ResultMetricCardIcon } from "./resultDetailData";

interface ResultMetricCardGridProps {
  cards: ResultMetricCardData[];
}

export function ResultMetricCardGrid({ cards }: ResultMetricCardGridProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {cards.map((card) => (
        <MetricCard
          key={card.id}
          label={card.label}
          value={card.value}
          format={card.format}
          icon={renderMetricIcon(card.icon)}
          variant={card.variant}
        />
      ))}
    </div>
  );
}

function renderMetricIcon(icon: ResultMetricCardIcon): React.ReactNode {
  if (icon === "trophy") return <Trophy className="h-4 w-4" />;
  if (icon === "trending") return <TrendingUp className="h-4 w-4" />;
  if (icon === "bar") return <BarChart3 className="h-4 w-4" />;
  return <Target className="h-4 w-4" />;
}

function MetricCard({
  label,
  value,
  format = 4,
  icon,
  variant = "default",
}: {
  label: string;
  value: number;
  format?: number;
  icon?: React.ReactNode;
  variant?: "default" | "primary" | "secondary";
}) {
  const bgClass = variant === "primary"
    ? "bg-chart-1/10 border-chart-1/20"
    : variant === "secondary"
    ? "bg-chart-2/10 border-chart-2/20"
    : "bg-muted/30";
  const textClass = variant === "primary"
    ? "text-chart-1"
    : variant === "secondary"
    ? "text-chart-2"
    : "text-foreground";

  return (
    <div className={cn("p-3 rounded-lg border", bgClass)}>
      <div className="flex items-center gap-2 mb-1">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      <p className={cn("text-xl font-bold", textClass)}>
        {value.toFixed(format)}
      </p>
    </div>
  );
}
