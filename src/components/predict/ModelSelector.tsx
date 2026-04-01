import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Check, GitBranch, Package, Search } from "lucide-react";

import { getAvailableModels } from "@/api/predict";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { getPredictionMetricLabel } from "@/lib/predict-metrics";
import { formatMetricValue } from "@/lib/scores";
import { cn } from "@/lib/utils";
import type { AvailableModel } from "@/types/predict";

interface ModelSelectorProps {
  selectedModel: AvailableModel | null;
  onSelect: (model: AvailableModel) => void;
}

function hasHydratedModel(model: AvailableModel | null): boolean {
  return Boolean(
    model && (
      model.model_class ||
      model.dataset_name ||
      model.preprocessing ||
      model.prediction_score != null ||
      model.best_score != null
    )
  );
}

export function ModelSelector({ selectedModel, onSelect }: ModelSelectorProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["available-models"],
    queryFn: getAvailableModels,
    staleTime: 30000,
  });

  const models = useMemo(() => data?.models ?? [], [data]);

  useEffect(() => {
    if (!selectedModel || hasHydratedModel(selectedModel) || models.length === 0) {
      return;
    }

    const hydrated = models.find(
      (model) => model.id === selectedModel.id && model.source === selectedModel.source,
    );

    if (hydrated) {
      onSelect(hydrated);
    }
  }, [models, onSelect, selectedModel]);

  const filtered = useMemo(() => {
    if (!search) return models;
    const query = search.toLowerCase();
    return models.filter((model) =>
      [
        model.name,
        model.model_class,
        model.dataset_name,
        model.preprocessing,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query)),
    );
  }, [models, search]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("predict.model.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (models.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("predict.model.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="py-10 text-center text-muted-foreground">
            <Package className="mx-auto mb-3 h-10 w-10 opacity-40" />
            <p className="font-medium">{t("predict.model.noModels")}</p>
            <p className="mt-1 text-sm">{t("predict.model.noModelsHint")}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>{t("predict.model.title")}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("predict.model.description")}
            </p>
          </div>
          <Badge variant="secondary" className="shrink-0">
            {filtered.length} / {models.length}
          </Badge>
        </div>

        <div className="rounded-xl border bg-muted/30 p-4">
          {selectedModel ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline">
                  {selectedModel.source === "bundle" ? "Bundle" : "Chain"}
                </Badge>
                <Badge variant="secondary">{selectedModel.model_class || selectedModel.name}</Badge>
                {selectedModel.has_refit && (
                  <Badge variant="outline" className="border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
                    refit
                  </Badge>
                )}
              </div>
              <div>
                <p className="text-sm font-semibold">{selectedModel.name}</p>
                <p className="text-sm text-muted-foreground">
                  {selectedModel.dataset_name || "Prediction bundle"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {selectedModel.prediction_score != null && selectedModel.prediction_metric && (
                  <span className="rounded-full bg-background px-2.5 py-1 font-medium text-foreground">
                    {getPredictionMetricLabel(selectedModel.prediction_metric)}{" "}
                    {formatMetricValue(selectedModel.prediction_score, selectedModel.prediction_metric)}
                  </span>
                )}
                {selectedModel.preprocessing && (
                  <span className="rounded-full bg-background px-2.5 py-1 text-muted-foreground">
                    {selectedModel.preprocessing}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-sm font-medium">No model selected</p>
              <p className="text-sm text-muted-foreground">
                Pick a trained chain or exported bundle to unlock the prediction workspace.
              </p>
            </div>
          )}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("predict.model.search")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>
      </CardHeader>

      <CardContent>
        <div className="max-h-[38rem] space-y-3 overflow-y-auto pr-1">
          {filtered.map((model) => {
            const isSelected =
              selectedModel?.id === model.id && selectedModel?.source === model.source;

            return (
              <button
                key={`${model.source}-${model.id}`}
                type="button"
                onClick={() => onSelect(model)}
                className={cn(
                  "w-full rounded-xl border p-4 text-left transition-colors",
                  "hover:border-primary/40 hover:bg-accent/40",
                  isSelected
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-border/70 bg-card",
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-2">
                        {model.source === "bundle" ? (
                          <Package className="h-4 w-4 text-primary" />
                        ) : (
                          <GitBranch className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="font-semibold">{model.name}</span>
                      </div>
                      <Badge variant="outline" className="text-[10px]">
                        {model.model_class}
                      </Badge>
                      {model.has_refit && (
                        <Badge variant="outline" className="border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
                          refit
                        </Badge>
                      )}
                    </div>

                    <div className="space-y-1 text-sm text-muted-foreground">
                      <p>{model.dataset_name || "Standalone exported bundle"}</p>
                      {model.preprocessing && (
                        <p className="line-clamp-2">{model.preprocessing}</p>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2 text-xs">
                      {model.prediction_score != null && model.prediction_metric && (
                        <span className="rounded-full bg-muted px-2.5 py-1 font-medium text-foreground">
                          {getPredictionMetricLabel(model.prediction_metric)}{" "}
                          {formatMetricValue(model.prediction_score, model.prediction_metric)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={model.source === "bundle" ? "secondary" : "outline"}>
                      {model.source}
                    </Badge>
                    {isSelected && <Check className="h-4 w-4 text-primary" />}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {filtered.length === 0 && search && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("common.noResults", { defaultValue: "No results found" })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
