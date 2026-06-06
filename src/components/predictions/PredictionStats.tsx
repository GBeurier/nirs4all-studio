import { Card, CardContent } from "@/components/ui/card";

interface PredictionStatsProps {
  stats: { total: number; datasets: number; models: number; pipelines: number };
}

export function PredictionStats({ stats }: PredictionStatsProps) {
  return (
    <div className="grid gap-2 md:grid-cols-4">
      <Card className="glass-card">
        <CardContent className="flex items-center justify-between px-3 py-1.5">
          <p className="text-[10px] text-muted-foreground uppercase font-medium">Total</p>
          <p className="text-sm font-bold">{stats.total.toLocaleString()}</p>
        </CardContent>
      </Card>
      <Card className="glass-card">
        <CardContent className="flex items-center justify-between px-3 py-1.5">
          <p className="text-[10px] text-muted-foreground uppercase font-medium">Datasets</p>
          <p className="text-sm font-bold">{stats.datasets}</p>
        </CardContent>
      </Card>
      <Card className="glass-card">
        <CardContent className="flex items-center justify-between px-3 py-1.5">
          <p className="text-[10px] text-muted-foreground uppercase font-medium">Models</p>
          <p className="text-sm font-bold">{stats.models}</p>
        </CardContent>
      </Card>
      <Card className="glass-card">
        <CardContent className="flex items-center justify-between px-3 py-1.5">
          <p className="text-[10px] text-muted-foreground uppercase font-medium">Pipelines</p>
          <p className="text-sm font-bold">{stats.pipelines}</p>
        </CardContent>
      </Card>
    </div>
  );
}
