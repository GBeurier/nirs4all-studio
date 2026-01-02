import { motion } from "framer-motion";
import { LucideIcon, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatsCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  trendValue?: number;
  trendDirection?: "up" | "down" | "neutral";
  isLoading?: boolean;
}

export function StatsCard({
  label,
  value,
  icon: Icon,
  trend,
  trendValue,
  trendDirection = "neutral",
  isLoading = false,
}: StatsCardProps) {
  return (
    <motion.div
      whileHover={{ scale: 1.02, y: -2 }}
      className="glass-card p-5 transition-all duration-300 hover:border-primary/30 hover:glow-primary"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          {isLoading ? (
            <div className="mt-2 h-8 w-16 animate-pulse rounded bg-muted" />
          ) : (
            <p className="mt-2 text-3xl font-bold text-foreground">{value}</p>
          )}
          {trend && (
            <div className="mt-1.5 flex items-center gap-1">
              {trendDirection === "up" && (
                <TrendingUp className="h-3 w-3 text-success" />
              )}
              {trendDirection === "down" && (
                <TrendingDown className="h-3 w-3 text-destructive" />
              )}
              <p
                className={cn(
                  "text-xs",
                  trendDirection === "up" && "text-success",
                  trendDirection === "down" && "text-destructive",
                  trendDirection === "neutral" && "text-muted-foreground"
                )}
              >
                {trendValue !== undefined && trendDirection === "up" && "+"}
                {trendValue !== undefined && `${trendValue}% `}
                {trend}
              </p>
            </div>
          )}
        </div>
        <div className="rounded-lg bg-primary/10 p-2.5">
          <Icon className="h-5 w-5 text-primary" />
        </div>
      </div>
    </motion.div>
  );
}
