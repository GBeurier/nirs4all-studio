import { useTranslation } from "react-i18next";

import { Card, CardContent } from "@/components/ui/card";
import { getActiveLocale } from "@/lib/activeLocale";

interface PredictionStatsProps {
  stats: { total: number; datasets: number; models: number; pipelines: number };
}

export function PredictionStats({ stats }: PredictionStatsProps) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-2 md:grid-cols-4">
      <Card className="glass-card">
        <CardContent className="flex items-center justify-between px-3 py-1.5">
          <p className="text-[10px] text-muted-foreground uppercase font-medium">{t("predictions.stats.total")}</p>
          <p className="text-sm font-bold">{stats.total.toLocaleString(getActiveLocale())}</p>
        </CardContent>
      </Card>
      <Card className="glass-card">
        <CardContent className="flex items-center justify-between px-3 py-1.5">
          <p className="text-[10px] text-muted-foreground uppercase font-medium">{t("predictions.stats.datasets")}</p>
          <p className="text-sm font-bold">{stats.datasets}</p>
        </CardContent>
      </Card>
      <Card className="glass-card">
        <CardContent className="flex items-center justify-between px-3 py-1.5">
          <p className="text-[10px] text-muted-foreground uppercase font-medium">{t("predictions.stats.models")}</p>
          <p className="text-sm font-bold">{stats.models}</p>
        </CardContent>
      </Card>
      <Card className="glass-card">
        <CardContent className="flex items-center justify-between px-3 py-1.5">
          <p className="text-[10px] text-muted-foreground uppercase font-medium">{t("predictions.stats.pipelines")}</p>
          <p className="text-sm font-bold">{stats.pipelines}</p>
        </CardContent>
      </Card>
    </div>
  );
}
