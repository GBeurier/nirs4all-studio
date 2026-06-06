import { BarChart3 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DisplayMetrics } from "@/lib/run-progress-display";

export function MetricsCard({
  metrics,
  label,
  primaryText,
  secondaryText,
  variantText,
  pendingMessage,
}: {
  metrics?: DisplayMetrics;
  label: string;
  primaryText?: string;
  secondaryText?: string;
  variantText?: string | null;
  pendingMessage?: string;
}) {
  if (!metrics && !pendingMessage) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          {label}
        </CardTitle>
        {primaryText && <div className="text-sm font-medium text-foreground">{primaryText}</div>}
        {secondaryText && <div className="text-xs text-muted-foreground leading-relaxed">{secondaryText}</div>}
        {variantText && (
          <div className="pt-1">
            <Badge variant="outline" className="max-w-full text-[10px] bg-violet-500/10 text-violet-600 border-violet-500/30 font-mono whitespace-normal break-words">
              {variantText}
            </Badge>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {metrics ? (
          <div className="grid grid-cols-2 gap-4">
            {metrics.r2 != null && (
              <div>
                <div className="text-2xl font-bold text-chart-1">
                  {(metrics.r2 * 100).toFixed(2)}%
                </div>
                <div className="text-xs text-muted-foreground">R² Score</div>
              </div>
            )}
            {metrics.rmse != null && (
              <div>
                <div className="text-2xl font-bold text-chart-2">
                  {metrics.rmse.toFixed(4)}
                </div>
                <div className="text-xs text-muted-foreground">RMSE</div>
              </div>
            )}
            {metrics.mae != null && (
              <div>
                <div className="text-lg font-semibold">
                  {metrics.mae.toFixed(4)}
                </div>
                <div className="text-xs text-muted-foreground">MAE</div>
              </div>
            )}
            {metrics.rpd != null && (
              <div>
                <div className="text-lg font-semibold">
                  {metrics.rpd.toFixed(2)}
                </div>
                <div className="text-xs text-muted-foreground">RPD</div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            {pendingMessage}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
