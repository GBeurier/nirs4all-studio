import { Box } from "lucide-react";
import { useTranslation } from "react-i18next";
import { badgeVariants } from "@/components/ui/badgeVariants";
import { cn } from "@/lib/utils";
import type { ScoreCardRow } from "@/types/score-cards";

export function ScoreCardModelName({ row, onViewDetails }: {
  row: ScoreCardRow;
  onViewDetails?: () => void;
}) {
  const { t } = useTranslation();
  const Tag = onViewDetails ? "button" : "span";
  return (
    <Tag
      type={onViewDetails ? "button" : undefined}
      title={onViewDetails ? t("results.scores.row.viewDetails") : undefined}
      className={cn(
        badgeVariants({ variant: "outline" }),
        "min-w-0 max-w-full text-[10px] font-mono",
        row.cardType === "refit" && "border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
        row.cardType === "crossval" && "border-chart-1/30 text-chart-1",
        onViewDetails && "cursor-pointer hover:bg-muted",
      )}
      onClick={onViewDetails}
    >
      <Box className="mr-0.5 size-2.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{row.modelName}</span>
    </Tag>
  );
}
