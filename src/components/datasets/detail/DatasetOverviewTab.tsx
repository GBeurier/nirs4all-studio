/**
 * DatasetOverviewTab - Summary and metadata tab for dataset detail page
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Target, Info, FileSpreadsheet, Clock } from "lucide-react";
import type { Dataset, PreviewDataResponse } from "@/types/datasets";

interface DatasetOverviewTabProps {
  dataset: Dataset;
  preview: PreviewDataResponse | null;
}

/**
 * Get relative time string from ISO date
 */
function getRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

export function DatasetOverviewTab({ dataset, preview }: DatasetOverviewTabProps) {
  return (
    <div className="space-y-6">
      {/* Target Statistics */}
      {dataset.targets && dataset.targets.length > 0 && (
        <div className="grid md:grid-cols-2 gap-4">
          {dataset.targets.map((target) => (
            <Card key={target.column}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  {target.column}
                  {target.column === dataset.default_target && (
                    <Badge variant="default" className="text-xs">Default</Badge>
                  )}
                  <Badge variant="outline" className="text-xs capitalize">
                    {target.type || "auto"}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-4 gap-4 text-sm">
                  {preview?.target_distribution?.type === "regression" && (
                    <>
                      <div>
                        <p className="text-muted-foreground">Min</p>
                        <p className="font-mono font-medium">
                          {preview.target_distribution.min?.toFixed(3) || "--"}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Max</p>
                        <p className="font-mono font-medium">
                          {preview.target_distribution.max?.toFixed(3) || "--"}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Mean</p>
                        <p className="font-mono font-medium">
                          {preview.target_distribution.mean?.toFixed(3) || "--"}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Std</p>
                        <p className="font-mono font-medium">
                          {preview.target_distribution.std?.toFixed(3) || "--"}
                        </p>
                      </div>
                    </>
                  )}
                  {(!preview?.target_distribution || preview.target_distribution.type === "classification") && (
                    <>
                      <div>
                        <p className="text-muted-foreground">Type</p>
                        <p className="font-medium capitalize">{target.type || "auto"}</p>
                      </div>
                      {target.unit && (
                        <div>
                          <p className="text-muted-foreground">Unit</p>
                          <p className="font-medium">{target.unit}</p>
                        </div>
                      )}
                      {target.classes && (
                        <div className="col-span-2">
                          <p className="text-muted-foreground">Classes</p>
                          <p className="font-medium">{target.classes.length}</p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Dataset Metadata */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Info className="h-4 w-4" />
            Dataset Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Task Type</p>
              <Badge variant="outline" className="capitalize mt-1">
                {dataset.task_type || "auto"}
              </Badge>
            </div>
            {dataset.signal_types && dataset.signal_types.length > 0 && (
              <div>
                <p className="text-sm text-muted-foreground">Signal Type</p>
                <div className="flex gap-1 mt-1">
                  {dataset.signal_types.map((type) => (
                    <Badge key={type} variant="outline" className="text-xs">
                      {type}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            <div>
              <p className="text-sm text-muted-foreground">Multi-source</p>
              <Badge variant={dataset.is_multi_source ? "default" : "secondary"} className="mt-1">
                {dataset.is_multi_source ? "Yes" : "No"}
              </Badge>
            </div>
            {dataset.n_sources && dataset.n_sources > 1 && (
              <div>
                <p className="text-sm text-muted-foreground">Sources</p>
                <p className="font-medium mt-1">{dataset.n_sources}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Version Information */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Version History
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Linked</span>
            <span>{getRelativeTime(dataset.linked_at)}</span>
          </div>
          {dataset.version && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Version</span>
              <span className="font-mono">{dataset.version}</span>
            </div>
          )}
          {dataset.hash && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Hash</span>
              <span className="font-mono text-xs">{dataset.hash.slice(0, 12)}...</span>
            </div>
          )}
          {dataset.last_verified && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Last Verified</span>
              <span>{getRelativeTime(dataset.last_verified)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* File Path */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            Location
          </CardTitle>
        </CardHeader>
        <CardContent>
          <code className="text-xs bg-muted px-2 py-1 rounded block overflow-x-auto">
            {dataset.path}
          </code>
        </CardContent>
      </Card>
    </div>
  );
}
