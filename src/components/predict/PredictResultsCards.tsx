import { Activity } from "lucide-react";

import type {
  PredictMetricCardReadModel,
  PredictStatCardReadModel,
} from "./predictResultsData";

interface PredictMetricsSectionProps {
  cards: PredictMetricCardReadModel[];
  hasMetrics: boolean;
}

export function PredictMetricsSection({ cards, hasMetrics }: PredictMetricsSectionProps) {
  if (!hasMetrics || cards.length === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <div key={card.key} className="rounded-xl border bg-card p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {card.label}
          </p>
          <p className="mt-2 text-xl font-semibold">{card.value}</p>
        </div>
      ))}
    </div>
  );
}

interface PredictStatsSectionProps {
  cards: PredictStatCardReadModel[];
}

export function PredictStatsSection({ cards }: PredictStatsSectionProps) {
  if (cards.length === 0) return null;

  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <div className="flex items-center gap-2">
        <Activity className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Predicted distribution
        </p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-center sm:grid-cols-4 xl:grid-cols-8">
        {cards.map((card) => (
          <div key={card.label} className="rounded-lg bg-background p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {card.label}
            </p>
            <p className="mt-1 text-sm font-medium">{card.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
