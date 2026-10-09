import { Trophy } from "lucide-react";
import { useTranslation } from "react-i18next";

export function ResultMetricsRefitNotice() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
      <Trophy className="h-4 w-4 text-emerald-500 flex-shrink-0" />
      <div className="flex-1">
        <p className="text-sm font-medium text-foreground">{t("results.detail.refit.title")}</p>
        <p className="text-xs text-muted-foreground">
          {t("results.detail.refit.description")}
        </p>
      </div>
    </div>
  );
}
