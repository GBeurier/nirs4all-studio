/**
 * DatasetTargetsTab - Target distribution visualization tab for dataset detail page
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Target, RefreshCw, Loader2, AlertCircle } from "lucide-react";
import { TargetHistogram } from "../charts";
import type { Dataset, PreviewDataResponse } from "@/types/datasets";

interface DatasetTargetsTabProps {
  dataset: Dataset;
  preview: PreviewDataResponse | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

export function DatasetTargetsTab({
  dataset,
  preview,
  loading,
  error,
  onRefresh,
}: DatasetTargetsTabProps) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Loading target distribution...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <AlertCircle className="h-8 w-8 text-destructive mb-4" />
        <p className="text-destructive font-medium mb-2">Failed to load targets</p>
        <p className="text-sm text-muted-foreground mb-4 text-center max-w-md">
          {error}
        </p>
        <Button onClick={onRefresh} variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  const hasTargets = dataset.targets && dataset.targets.length > 0;
  const distribution = preview?.target_distribution;

  if (!hasTargets && !distribution) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Target className="h-8 w-8 text-muted-foreground mb-4 opacity-50" />
        <p className="text-muted-foreground mb-2">No targets configured</p>
        <p className="text-sm text-muted-foreground text-center max-w-md">
          Add target variables during dataset creation or edit the dataset configuration.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Target List */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="h-4 w-4" />
            Target Variables
            {hasTargets && (
              <Badge variant="secondary" className="ml-2">
                {dataset.targets!.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {hasTargets ? (
            <div className="space-y-3">
              {dataset.targets!.map((target) => (
                <div
                  key={target.column}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/30"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-medium">{target.column}</span>
                    {target.column === dataset.default_target && (
                      <Badge variant="default" className="text-xs">Default</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="capitalize text-xs">
                      {target.type || "auto"}
                    </Badge>
                    {target.unit && (
                      <span className="text-sm text-muted-foreground">
                        {target.unit}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No targets defined</p>
          )}
        </CardContent>
      </Card>

      {/* Distribution Chart */}
      {distribution && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                Distribution
                <Badge variant="outline" className="text-xs capitalize">
                  {distribution.type}
                </Badge>
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={onRefresh}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              {/* Histogram */}
              {distribution.histogram && (
                <div>
                  <TargetHistogram
                    data={distribution.histogram}
                    type={distribution.type}
                    width={400}
                    height={220}
                  />
                </div>
              )}

              {/* Statistics */}
              <div className="space-y-4">
                {distribution.type === "regression" && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 bg-muted/30 rounded-lg">
                        <p className="text-xs text-muted-foreground">Minimum</p>
                        <p className="font-mono font-medium text-lg">
                          {distribution.min?.toFixed(3) || "--"}
                        </p>
                      </div>
                      <div className="p-3 bg-muted/30 rounded-lg">
                        <p className="text-xs text-muted-foreground">Maximum</p>
                        <p className="font-mono font-medium text-lg">
                          {distribution.max?.toFixed(3) || "--"}
                        </p>
                      </div>
                      <div className="p-3 bg-muted/30 rounded-lg">
                        <p className="text-xs text-muted-foreground">Mean</p>
                        <p className="font-mono font-medium text-lg">
                          {distribution.mean?.toFixed(3) || "--"}
                        </p>
                      </div>
                      <div className="p-3 bg-muted/30 rounded-lg">
                        <p className="text-xs text-muted-foreground">Std Dev</p>
                        <p className="font-mono font-medium text-lg">
                          {distribution.std?.toFixed(3) || "--"}
                        </p>
                      </div>
                    </div>
                    {distribution.mean && distribution.std && (
                      <div className="p-3 bg-muted/30 rounded-lg">
                        <p className="text-xs text-muted-foreground">Range (±3σ)</p>
                        <p className="font-mono font-medium">
                          {(distribution.mean - 3 * distribution.std).toFixed(2)} to{" "}
                          {(distribution.mean + 3 * distribution.std).toFixed(2)}
                        </p>
                      </div>
                    )}
                  </>
                )}

                {distribution.type === "classification" && distribution.class_counts && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium mb-3">Class Distribution</p>
                    {Object.entries(distribution.class_counts).map(([cls, count]) => (
                      <div
                        key={cls}
                        className="flex items-center justify-between p-2 bg-muted/30 rounded"
                      >
                        <span className="font-medium">{cls}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono">{count}</span>
                          <span className="text-xs text-muted-foreground">
                            ({((count / Object.values(distribution.class_counts!).reduce((a, b) => a + b, 0)) * 100).toFixed(1)}%)
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {distribution.classes && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">Classes</p>
                    <div className="flex flex-wrap gap-2">
                      {distribution.classes.map((cls) => (
                        <Badge key={cls} variant="outline">
                          {cls}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
