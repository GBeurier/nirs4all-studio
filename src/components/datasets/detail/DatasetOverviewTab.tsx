/**
 * DatasetOverviewTab - Summary and metadata tab for dataset detail page
 */
import { useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getConfiguredRepetitionColumn } from "@/lib/datasetConfig";
import { getDatasetTaskLabel } from "@/lib/datasetTask";
import { getRepeatIndexColumnWarning } from "@/lib/playground/repetition";
import { Target, Info, FileSpreadsheet, Clock, GitBranch } from "lucide-react";
import { TargetHistogram } from "../charts";
import { buildTargetHistogramData } from "../charts/targetHistogramData";
import { PartitionToggle } from "../PartitionToggle";
import { getPartitionTheme } from "../partitionTheme";
import {
  formatCount,
  getDatasetOverviewSampleCounts,
  getEffectivePartition,
  getEffectiveTargetDistribution,
  getPartitionSampleCount,
  getRelativeTime,
  hasTestPartition,
} from "./DatasetOverviewTabData";
import type {
  Dataset,
  PartitionKey,
  PreviewDataResponse,
} from "@/types/datasets";

interface DatasetOverviewTabProps {
  dataset: Dataset;
  preview: PreviewDataResponse | null;
}

export function DatasetOverviewTab({ dataset, preview }: DatasetOverviewTabProps) {
  const { t } = useTranslation();
  const repetitionColumn = getConfiguredRepetitionColumn(dataset.config);
  const repetitionColumnWarning = getRepeatIndexColumnWarning(repetitionColumn);

  const { trainCount, testCount } = getDatasetOverviewSampleCounts(dataset, preview);
  const hasTest = hasTestPartition(preview?.target_distribution_by_partition, testCount);

  const [partition, setPartition] = useState<PartitionKey>("all");
  const effectivePartition = getEffectivePartition(partition, hasTest);
  const partitionTheme = getPartitionTheme(effectivePartition);

  const distribution = useMemo(
    () => getEffectiveTargetDistribution(preview, effectivePartition),
    [preview, effectivePartition],
  );

  const partitionSampleCount = getPartitionSampleCount({
    distribution,
    effectivePartition,
    trainCount,
    testCount,
    totalCount: dataset.num_samples,
  });
  const histogramData = useMemo(() => buildTargetHistogramData(distribution), [distribution]);

  return (
    <div className="space-y-6">
      {distribution && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Target className="h-4 w-4" />
                {t("datasets.detail.overview.targetDistribution")}
                <Badge variant="outline" className="text-xs capitalize">
                  {distribution.type === "regression" || distribution.type === "classification" ? t(`datasets.detail.distType.${distribution.type}`) : distribution.type}
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
                    {t("datasets.detail.overview.noDistribution")}
                  </div>
                )}
              </div>
              <div className="space-y-3">
                <div className="p-3 bg-muted/30 rounded-lg">
                  <p className="text-xs text-muted-foreground">{t("datasets.detail.overview.partition")}</p>
                  <p className="font-medium mt-1">{t(`datasets.detail.partitions.${effectivePartition}`)}</p>
                  <p className="text-[10px] tabular-nums text-muted-foreground mt-1">
                    {t("datasets.detail.overview.samplesCount", { count: partitionSampleCount ?? 0, value: formatCount(partitionSampleCount) })}
                  </p>
                </div>
                {distribution.type === "regression" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-muted/30 rounded-lg">
                      <p className="text-xs text-muted-foreground">{t("datasets.detail.stats.min")}</p>
                      <p className="font-mono font-medium">{distribution.min?.toFixed(3) || "--"}</p>
                    </div>
                    <div className="p-3 bg-muted/30 rounded-lg">
                      <p className="text-xs text-muted-foreground">{t("datasets.detail.stats.max")}</p>
                      <p className="font-mono font-medium">{distribution.max?.toFixed(3) || "--"}</p>
                    </div>
                    <div className="p-3 bg-muted/30 rounded-lg">
                      <p className="text-xs text-muted-foreground">{t("datasets.detail.stats.mean")}</p>
                      <p className="font-mono font-medium">{distribution.mean?.toFixed(3) || "--"}</p>
                    </div>
                    <div className="p-3 bg-muted/30 rounded-lg">
                      <p className="text-xs text-muted-foreground">{t("datasets.detail.stats.std")}</p>
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
                    <Badge variant="default" className="text-xs">{t("common.default")}</Badge>
                  )}
                  <Badge variant="outline" className="text-xs capitalize">
                    {getDatasetTaskLabel(target.type, t, { fallback: t("datasets.task.auto") })}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 text-sm lg:grid-cols-4">
                  {distribution?.type === "regression" ? (
                    <>
                      <div>
                        <p className="text-muted-foreground">{t("datasets.detail.stats.min")}</p>
                        <p className="font-mono font-medium">{distribution.min?.toFixed(3) || "--"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">{t("datasets.detail.stats.max")}</p>
                        <p className="font-mono font-medium">{distribution.max?.toFixed(3) || "--"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">{t("datasets.detail.stats.mean")}</p>
                        <p className="font-mono font-medium">{distribution.mean?.toFixed(3) || "--"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">{t("datasets.detail.stats.std")}</p>
                        <p className="font-mono font-medium">{distribution.std?.toFixed(3) || "--"}</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <p className="text-muted-foreground">{t("datasets.detail.overview.type")}</p>
                        <p className="font-medium">
                          {getDatasetTaskLabel(target.type, t, { fallback: t("datasets.task.auto") })}
                        </p>
                      </div>
                      {target.unit && (
                        <div>
                          <p className="text-muted-foreground">{t("datasets.detail.overview.unit")}</p>
                          <p className="font-medium">{target.unit}</p>
                        </div>
                      )}
                      {target.classes && (
                        <div className="col-span-2">
                          <p className="text-muted-foreground">{t("datasets.detail.overview.classes")}</p>
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
            <GitBranch className="h-4 w-4" />
            {t("datasets.detail.overview.splitting")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {repetitionColumn ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{t("datasets.detail.overview.configuredRepetition")}</Badge>
                <code className="rounded bg-muted px-2 py-1 text-xs">{repetitionColumn}</code>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                <Trans
                  i18nKey="datasets.detail.overview.repetitionApplied"
                  values={{ column: repetitionColumn }}
                  components={{ code: <code /> }}
                />
              </p>
              {repetitionColumnWarning && (
                <p className="text-sm leading-relaxed text-amber-700 dark:text-amber-400">
                  {repetitionColumnWarning}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm leading-relaxed text-muted-foreground">
              <Trans i18nKey="datasets.detail.overview.noRepetition" components={{ code: <code /> }} />
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Info className="h-4 w-4" />
            {t("datasets.detail.overview.info")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            <div>
              <p className="text-sm text-muted-foreground">{t("datasets.detail.overview.taskType")}</p>
              <Badge variant="outline" className="mt-1">
                {getDatasetTaskLabel(dataset.task_type, t, {
                  numClasses: dataset.num_classes,
                  fallback: t("datasets.task.auto"),
                })}
              </Badge>
            </div>
            {testCount != null && testCount > 0 && (
              <div>
                <p className="text-sm text-muted-foreground">{t("datasets.detail.overview.partitions")}</p>
                <p className="font-mono text-sm font-medium mt-1 tabular-nums">
                  {t("datasets.detail.overview.trainTest", { train: formatCount(trainCount), test: formatCount(testCount) })}
                </p>
              </div>
            )}
            {dataset.signal_types && dataset.signal_types.length > 0 && (
              <div>
                <p className="text-sm text-muted-foreground">{t("datasets.detail.overview.signalType")}</p>
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
              <p className="text-sm text-muted-foreground">{t("datasets.detail.overview.multiSource")}</p>
              <Badge variant={dataset.is_multi_source ? "default" : "secondary"} className="mt-1">
                {dataset.is_multi_source ? t("common.yes") : t("common.no")}
              </Badge>
            </div>
            {dataset.n_sources && dataset.n_sources > 1 && (
              <div>
                <p className="text-sm text-muted-foreground">{t("datasets.detail.overview.sources")}</p>
                <p className="font-medium mt-1">{dataset.n_sources}</p>
              </div>
            )}
            {repetitionColumn && (
              <div>
                <p className="text-sm text-muted-foreground">{t("datasets.detail.overview.repetitionGroupColumn")}</p>
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
            {t("datasets.detail.overview.versionHistory")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t("datasets.detail.overview.linked")}</span>
            <span>{getRelativeTime(dataset.linked_at, t)}</span>
          </div>
          {dataset.version && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("datasets.detail.overview.version")}</span>
              <span className="font-mono">{dataset.version}</span>
            </div>
          )}
          {dataset.hash && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("datasets.detail.overview.hash")}</span>
              <span className="font-mono text-xs">{dataset.hash.slice(0, 12)}...</span>
            </div>
          )}
          {dataset.last_verified && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("datasets.detail.overview.lastVerified")}</span>
              <span>{getRelativeTime(dataset.last_verified, t)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            {t("datasets.detail.overview.location")}
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
