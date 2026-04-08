/**
 * DatasetOverviewTab - Summary and metadata tab for dataset detail page
 */
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getConfiguredRepetitionColumn } from "@/lib/datasetConfig";
import { Target, Info, FileSpreadsheet, Clock } from "lucide-react";
import { TargetHistogram } from "../charts";
import { buildTargetHistogramData } from "../charts/TargetHistogram";
import { PartitionToggle } from "../PartitionToggle";
import { getPartitionTheme } from "../partitionTheme";
import type {
  Dataset,
  PartitionKey,
  PreviewDataResponse,
  TargetDistribution,
} from "@/types/datasets";

interface DatasetOverviewTabProps {
  dataset: Dataset;
  preview: PreviewDataResponse | null;
}

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

function formatCount(value: number | null | undefined): string {
  if (value == null) return "--";
  return value.toLocaleString();
}

export function DatasetOverviewTab({ dataset, preview }: DatasetOverviewTabProps) {
  const repetitionColumn = getConfiguredRepetitionColumn(dataset.config);

  const trainCount = preview?.summary?.train_samples ?? dataset.train_samples;
  const testCount = preview?.summary?.test_samples ?? dataset.test_samples;
  const hasTest = !!preview?.target_distribution_by_partition?.test || (testCount != null && testCount > 0);

  const [partition, setPartition] = useState<PartitionKey>("all");
  const effectivePartition: PartitionKey = !hasTest && partition !== "train" ? "train" : partition;
  const partitionTheme = getPartitionTheme(effectivePartition);

  const distribution: TargetDistribution | undefined = useMemo(() => {
    if (preview?.target_distribution_by_partition) {
      return preview.target_distribution_by_partition[effectivePartition]
        ?? preview.target_distribution_by_partition.train
        ?? preview.target_distribution;
    }
    return preview?.target_distribution;
  }, [preview?.target_distribution_by_partition, preview?.target_distribution, effectivePartition]);

  const partitionSampleCount = distribution?.n_samples ?? (
    effectivePartition === "test"
      ? testCount
      : effectivePartition === "train"
      ? trainCount
      : ((trainCount ?? 0) + (testCount ?? 0)) || dataset.num_samples
  );
  const histogramData = useMemo(() => buildTargetHistogramData(distribution), [distribution]);

  return (
    <div className="space-y-6">
      {distribution && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Target className="h-4 w-4" />
                Target Distribution
                <Badge variant="outline" className="text-xs capitalize">
                  {distribution.type}
                </Badge>
              </CardTitle>
              <PartitionToggle
                value={effectivePartition}
                onChange={setPartition}
                hasTest={hasTest}
                trainCount={trainCount}
                testCount={testCount}
                size="xs"
              />
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(220px,1fr)] gap-6 items-start">
              <div>
                {histogramData.length > 0 ? (
                  <div className="rounded-xl border bg-muted/20 p-3 sm:p-4">
                    <TargetHistogram
                      data={histogramData}
                      type={distribution.type}
                      width={560}
                      height={240}
                      barColor={partitionTheme.histogramColor}
                    />
                  </div>
                ) : (
                  <div className="h-[220px] flex items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                    No distribution preview available
                  </div>
                )}
              </div>
              <div className="space-y-3">
                <div className="p-3 bg-muted/30 rounded-lg">
                  <p className="text-xs text-muted-foreground">Partition</p>
                  <p className="font-medium mt-1">{partitionTheme.label}</p>
                  <p className="text-[10px] tabular-nums text-muted-foreground mt-1">
                    {formatCount(partitionSampleCount)} samples
                  </p>
                </div>
                {distribution.type === "regression" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-muted/30 rounded-lg">
                      <p className="text-xs text-muted-foreground">Min</p>
                      <p className="font-mono font-medium">{distribution.min?.toFixed(3) || "--"}</p>
                    </div>
                    <div className="p-3 bg-muted/30 rounded-lg">
                      <p className="text-xs text-muted-foreground">Max</p>
                      <p className="font-mono font-medium">{distribution.max?.toFixed(3) || "--"}</p>
                    </div>
                    <div className="p-3 bg-muted/30 rounded-lg">
                      <p className="text-xs text-muted-foreground">Mean</p>
                      <p className="font-mono font-medium">{distribution.mean?.toFixed(3) || "--"}</p>
                    </div>
                    <div className="p-3 bg-muted/30 rounded-lg">
                      <p className="text-xs text-muted-foreground">Std</p>
                      <p className="font-mono font-medium">{distribution.std?.toFixed(3) || "--"}</p>
                    </div>
                  </div>
                )}
                {distribution.type === "classification" && distribution.class_counts && (
                  <div className="space-y-2">
                    {Object.entries(distribution.class_counts).map(([label, count]) => (
                      <div key={label} className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2 text-sm">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-mono font-medium">{count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

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
                <div className="grid grid-cols-2 gap-4 text-sm lg:grid-cols-4">
                  {distribution?.type === "regression" ? (
                    <>
                      <div>
                        <p className="text-muted-foreground">Min</p>
                        <p className="font-mono font-medium">{distribution.min?.toFixed(3) || "--"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Max</p>
                        <p className="font-mono font-medium">{distribution.max?.toFixed(3) || "--"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Mean</p>
                        <p className="font-mono font-medium">{distribution.mean?.toFixed(3) || "--"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Std</p>
                        <p className="font-mono font-medium">{distribution.std?.toFixed(3) || "--"}</p>
                      </div>
                    </>
                  ) : (
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

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Info className="h-4 w-4" />
            Dataset Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            <div>
              <p className="text-sm text-muted-foreground">Task Type</p>
              <Badge variant="outline" className="capitalize mt-1">
                {dataset.task_type || "auto"}
              </Badge>
            </div>
            {testCount != null && testCount > 0 && (
              <div>
                <p className="text-sm text-muted-foreground">Partitions</p>
                <p className="font-mono text-sm font-medium mt-1 tabular-nums">
                  {formatCount(trainCount)} train · {formatCount(testCount)} test
                </p>
              </div>
            )}
            {dataset.signal_types && dataset.signal_types.length > 0 && (
              <div>
                <p className="text-sm text-muted-foreground">Signal Type</p>
                <div className="flex gap-1 mt-1">
                  {Array.from(new Set(dataset.signal_types)).map((type) => (
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
            {repetitionColumn && (
              <div>
                <p className="text-sm text-muted-foreground">Repetition Column</p>
                <p className="font-mono text-sm font-medium mt-1" title={repetitionColumn}>
                  {repetitionColumn}
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

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
