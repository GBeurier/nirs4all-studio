/**
 * DatasetSpectraTab - Full spectra visualization tab for dataset detail page
 */
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarChart3, RefreshCw, Loader2, AlertCircle, Settings } from "lucide-react";
import { SpectraChart } from "../charts";
import { PartitionToggle } from "../PartitionToggle";
import { getPartitionTheme } from "../partitionTheme";
import { getDatasetSpectraPreviewReadModel } from "../DatasetPreviewData";
import type { PartitionKey, PreviewDataResponse } from "@/types/datasets";
import { getActiveLocale } from "@/lib/activeLocale";

interface DatasetSpectraTabProps {
  preview: PreviewDataResponse | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

export function DatasetSpectraTab({
  preview,
  loading,
  error,
  onRefresh,
}: DatasetSpectraTabProps) {
  const { t } = useTranslation();
  const [partition, setPartition] = useState<PartitionKey>("all");
  const [selectedSource, setSelectedSource] = useState(0);
  const {
    trainCount,
    testCount,
    sourceCount,
    hasTest,
    hasPerSource,
    effectivePartition,
    spectra,
    spectraSampleCount,
  } = useMemo(
    () => getDatasetSpectraPreviewReadModel(preview, partition, selectedSource),
    [preview, partition, selectedSource],
  );
  const partitionTheme = getPartitionTheme(effectivePartition);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">{t("datasets.detail.spectra.loading")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <AlertCircle className="h-8 w-8 text-destructive mb-4" />
        <p className="text-destructive font-medium mb-2">{t("datasets.detail.spectra.loadFailed")}</p>
        <p className="text-sm text-muted-foreground mb-4 text-center max-w-md">
          {error}
        </p>
        <Button onClick={onRefresh} variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" />
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  if (!spectra) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <BarChart3 className="h-8 w-8 text-muted-foreground mb-4 opacity-50" />
        <p className="text-muted-foreground">{t("datasets.detail.spectra.noData")}</p>
        <Button onClick={onRefresh} variant="outline" className="mt-4">
          <RefreshCw className="h-4 w-4 mr-2" />
          {t("datasets.detail.spectra.loadPreview")}
        </Button>
      </div>
    );
  }

  const wavelengthMin = Math.min(...spectra.wavelengths);
  const wavelengthMax = Math.max(...spectra.wavelengths);

  return (
    <div className="space-y-6">
      {/* Main Spectra Chart */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              {t("datasets.detail.spectra.overview")}
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              {hasPerSource && (
                <div className="flex items-center gap-2 mr-2">
                  <span className="text-sm text-muted-foreground whitespace-nowrap">{t("datasets.detail.spectra.source")}</span>
                  <select
                    aria-label={t("datasets.detail.spectra.sourceLabel")}
                    className="flex h-8 w-32 items-center justify-between rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    value={selectedSource}
                    onChange={(e) => setSelectedSource(Number(e.target.value))}
                  >
                    {Array.from({ length: sourceCount }).map((_, i) => (
                      <option key={i} value={i}>
                        {t("datasets.wizard.fileMapping.row.sourceN", { n: i + 1 })}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <PartitionToggle
                value={effectivePartition}
                onChange={setPartition}
                hasTest={hasTest}
                trainCount={trainCount}
                testCount={testCount}
                size="xs"
              />
              <Badge variant="outline" className="text-xs">
                {t("datasets.detail.spectra.points", { count: spectra.wavelengths.length })}
              </Badge>
              <Button variant="ghost" size="sm" onClick={onRefresh} aria-label={t("common.refresh")}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border bg-muted/20 p-3 sm:p-4">
            <SpectraChart
              wavelengths={spectra.wavelengths}
              meanSpectrum={spectra.mean_spectrum}
              minSpectrum={spectra.min_spectrum}
              maxSpectrum={spectra.max_spectrum}
              width={960}
              height={360}
              unit={preview?.summary?.header_unit}
              yLabel={t("datasets.detail.spectra.absorbance")}
              lineColor={partitionTheme.lineColor}
              rangeFillColor={partitionTheme.rangeFillColor}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-3 text-center">
            {t("datasets.detail.spectra.caption")}
          </p>
        </CardContent>
      </Card>

      {/* Spectral Statistics */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">{t("datasets.detail.spectra.wavelengthRange")}</p>
            <p className="text-lg font-semibold">
              {wavelengthMin.toFixed(0)} - {wavelengthMax.toFixed(0)}
            </p>
            <p className="text-xs text-muted-foreground">
              {preview?.summary?.header_unit === "nm" ? "nm" : preview?.summary?.header_unit === "cm-1" ? "cm⁻¹" : t("datasets.detail.spectra.units")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">{t("datasets.detail.spectra.dataPoints")}</p>
            <p className="text-lg font-semibold">
              {spectra.wavelengths.length.toLocaleString(getActiveLocale())}
            </p>
            <p className="text-xs text-muted-foreground">{t("datasets.detail.spectra.perSpectrum")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">{t("datasets.detail.spectra.meanRange")}</p>
            <p className="text-lg font-semibold">
              {Math.min(...spectra.mean_spectrum).toFixed(3)} - {Math.max(...spectra.mean_spectrum).toFixed(3)}
            </p>
            <p className="text-xs text-muted-foreground">{t("datasets.detail.spectra.absorbanceLower")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">{t("datasets.detail.spectra.samples")}</p>
            <p className="text-lg font-semibold">
              {spectraSampleCount.toLocaleString(getActiveLocale()) || "--"}
            </p>
            <p className="text-xs text-muted-foreground">{t(`datasets.detail.partitions.${effectivePartition}`)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Configuration hint */}
      <Card className="border-dashed">
        <CardContent className="pt-4">
          <div className="flex items-center gap-3">
            <Settings className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">{t("datasets.detail.spectra.configure")}</p>
              <p className="text-xs text-muted-foreground">
                {t("datasets.detail.spectra.configureHint")}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
