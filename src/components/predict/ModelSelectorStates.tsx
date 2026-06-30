import { Filter, Package } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface ModelSelectorLoadingCardProps {
  title: string;
}

export function ModelSelectorLoadingCard({ title }: ModelSelectorLoadingCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
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

interface ModelSelectorNoModelsCardProps {
  title: string;
  message: string;
  hint: string;
}

export function ModelSelectorNoModelsCard({
  title,
  message,
  hint,
}: ModelSelectorNoModelsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="py-10 text-center text-muted-foreground">
          <Package className="mx-auto mb-3 h-10 w-10 opacity-40" />
          <p className="font-medium">{message}</p>
          <p className="mt-1 text-sm">{hint}</p>
        </div>
      </CardContent>
    </Card>
  );
}

interface ModelSelectorEmptyResultsProps {
  activeFilterCount: number;
  onClearFilters: () => void;
}

export function ModelSelectorEmptyResults({
  activeFilterCount,
  onClearFilters,
}: ModelSelectorEmptyResultsProps) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <Filter className="h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm font-medium">No models match</p>
      <p className="text-xs text-muted-foreground">
        Try adjusting filters or the search query.
      </p>
      {activeFilterCount > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="mt-2 h-7 text-xs"
          onClick={onClearFilters}
        >
          Clear filters
        </Button>
      )}
    </div>
  );
}
