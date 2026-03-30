import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Search, Package, GitBranch, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getAvailableModels } from "@/api/predict";
import { formatMetricValue } from "@/lib/scores";
import type { AvailableModel } from "@/types/predict";

interface ModelSelectorProps {
  selectedModel: AvailableModel | null;
  onSelect: (model: AvailableModel) => void;
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

  const filtered = useMemo(() => {
    if (!search) return models;
    const q = search.toLowerCase();
    return models.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.model_class.toLowerCase().includes(q) ||
        (m.dataset_name && m.dataset_name.toLowerCase().includes(q))
    );
  }, [models, search]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("predict.model.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
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
          <div className="text-center py-8 text-muted-foreground">
            <Package className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">{t("predict.model.noModels")}</p>
            <p className="text-sm mt-1">{t("predict.model.noModelsHint")}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("predict.model.title")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("predict.model.description")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("predict.model.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {filtered.map((model) => {
            const isSelected = selectedModel?.id === model.id;
            return (
              <Button
                key={`${model.source}-${model.id}`}
                variant={isSelected ? "secondary" : "outline"}
                className="w-full justify-start h-auto py-3 px-4"
                onClick={() => onSelect(model)}
              >
                <div className="flex items-center gap-3 w-full min-w-0">
                  {model.source === "bundle" ? (
                    <Package className="h-4 w-4 shrink-0 text-primary" />
                  ) : (
                    <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}

                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{model.name}</span>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {model.model_class}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                      {model.dataset_name && (
                        <span className="truncate">{model.dataset_name}</span>
                      )}
                      {model.best_score != null && model.metric && (
                        <span>
                          {model.metric}: {formatMetricValue(model.best_score)}
                        </span>
                      )}
                      {model.preprocessing && (
                        <span className="truncate opacity-60">
                          {model.preprocessing}
                        </span>
                      )}
                    </div>
                  </div>

                  {isSelected && (
                    <Check className="h-4 w-4 shrink-0 text-primary" />
                  )}
                </div>
              </Button>
            );
          })}
        </div>

        {filtered.length === 0 && search && (
          <p className="text-center text-sm text-muted-foreground py-4">
            {t("common.noResults", { defaultValue: "No results found" })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
