import { useTranslation } from "react-i18next";
import {
  Brain,
  Database,
  Download,
  FileText,
  RotateCcw,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardHeader, CardTitle } from "@/components/ui/card";

import type {
  PredictionInput,
  PredictBadgeReadModel,
  PredictPreprocessingBadgeReadModel,
  PredictSummaryCardReadModel,
} from "./predictResultsData";

interface PredictResultsHeaderProps {
  displayName: string;
  displaySubLabel: string | null;
  input: PredictionInput | null;
  modelName: string;
  numSamples: number;
  onExportTableCsv: () => void;
  onReset: () => void;
  preprocessingBadges: PredictPreprocessingBadgeReadModel[];
  referenceBadge: PredictBadgeReadModel;
  summaryCards: PredictSummaryCardReadModel[];
  taskBadge: PredictBadgeReadModel;
}

export function PredictResultsHeader({
  displayName,
  displaySubLabel,
  input,
  modelName,
  numSamples,
  onExportTableCsv,
  onReset,
  preprocessingBadges,
  referenceBadge,
  summaryCards,
  taskBadge,
}: PredictResultsHeaderProps) {
  const { t } = useTranslation();

  return (
    <CardHeader className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-lg">{t("predict.results.title")}</CardTitle>
            <Badge variant="outline" className={taskBadge.className}>
              {taskBadge.label}
            </Badge>
            <Badge variant="outline" className={referenceBadge.className}>
              {referenceBadge.label}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {t("predict.results.summary", {
              count: numSamples,
              model: modelName,
            })}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              {input?.type === "file" ? (
                <FileText className="h-3.5 w-3.5" />
              ) : (
                <Database className="h-3.5 w-3.5" />
              )}
              {displayName}
              {displaySubLabel && (
                <span className="text-muted-foreground/70">({displaySubLabel})</span>
              )}
            </span>
            <span className="inline-flex items-center gap-1">
              <Brain className="h-3.5 w-3.5 text-primary" />
              {modelName}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onExportTableCsv}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            {t("predict.results.export.csv")}
          </Button>
          <Button variant="outline" size="sm" onClick={onReset}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            {t("predict.results.newPrediction")}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {summaryCards.map((card) => (
          <div key={card.key} className="rounded-xl border bg-muted/30 p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {card.label}
            </p>
            <p className="mt-2 text-2xl font-semibold">{card.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {card.description}
            </p>
          </div>
        ))}
      </div>

      {preprocessingBadges.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Preprocessing
          </span>
          {preprocessingBadges.map((badge) => (
            <Badge key={badge.key} variant="outline" className="text-xs">
              {badge.label}
            </Badge>
          ))}
        </div>
      )}
    </CardHeader>
  );
}
