/**
 * FinetuningBadge - Visual indicator for finetuning status
 */

import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { FinetuneConfig } from "../types";

interface FinetuningBadgeProps {
  config: FinetuneConfig | undefined;
  onClick?: () => void;
  className?: string;
}

export function FinetuningBadge({
  config,
  onClick,
  className,
}: FinetuningBadgeProps) {
  if (!config?.enabled) return null;

  return (
    <Badge
      variant="secondary"
      onClick={onClick}
      className={cn(
        "text-xs bg-purple-500/20 text-purple-600 cursor-pointer hover:bg-purple-500/30 transition-colors gap-1",
        className
      )}
    >
      <Sparkles className="h-3 w-3" />
      {config.n_trials} trials
    </Badge>
  );
}
