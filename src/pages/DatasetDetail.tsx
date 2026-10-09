/**
 * DatasetDetail - Full page view for a single dataset
 *
 * Provides comprehensive dataset information with tabs for:
 * - Overview: Summary, metadata, version info
 * - Spectra: Full spectral visualization
 * - Targets: Target distribution and statistics
 * - Raw Data: Paginated data table
 */
import { useMemo, useState } from "react";
import { MlLoadingOverlay } from "@/components/layout/MlLoadingOverlay";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "@/lib/motion";
import {
  ArrowLeft,
  FileSpreadsheet,
  Play,
  RefreshCw,
  Loader2,
  AlertCircle,
  BarChart3,
  Target,
  Table,
  Info,
  Layers,
  Hash,
  FlaskConical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMlReadiness } from "@/context/useMlReadiness";
import {
  DatasetOverviewTab,
  DatasetSpectraTab,
  DatasetTargetsTab,
  DatasetRawDataTab,
} from "@/components/datasets/detail";
import {
  useDatasetQuery,
  useDatasetPreviewQuery,
} from "@/hooks/useDatasetQueries";
import { getConfiguredRepetitionColumn } from "@/lib/datasetConfig";
import { getDatasetTaskLabel } from "@/lib/datasetTask";
import { getMultimodalDatasetSummary, isStudioMultimodalDatasetDocument } from "@/lib/multimodalDatasetSummary";
import { MultimodalDatasetOverview } from "@/components/datasets/MultimodalDatasetOverview";
import { getRepeatIndexColumnWarning } from "@/lib/playground/repetition";
import { getApiErrorMessage } from "@/api/transport";
import { getActiveLocale } from "@/lib/activeLocale";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

/**
 * Format number with locale-aware separators
 */
function formatNumber(num: number | undefined): string {
  if (num === undefined || num === null) return "--";
  return num.toLocaleString(getActiveLocale());
}

export default function DatasetDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { workspaceReady } = useMlReadiness();

  // Server state via React Query — both queries are cached for 5 minutes and
  // shared with DatasetQuickView, so navigating between Datasets ↔ Detail
  // reuses already-fetched data instead of re-hitting the backend.
  const datasetQuery = useDatasetQuery(id);
  const dataset = datasetQuery.data ?? null;
  const descriptor = dataset?.config?.dataset_document;
  const multimodal = useMemo(() => getMultimodalDatasetSummary(descriptor), [descriptor]);
  const hasMultimodalDocument = isStudioMultimodalDatasetDocument(descriptor);
  const previewQuery = useDatasetPreviewQuery(id, 100, !!dataset && !hasMultimodalDocument);
  const loading = datasetQuery.isLoading;
  const error = getApiErrorMessage(datasetQuery.error);
  const preview = previewQuery.data ?? null;
  const waitingForWorkspace = !!id && !workspaceReady && !preview && !hasMultimodalDocument;
  const previewLoading =
    !hasMultimodalDocument && (waitingForWorkspace || previewQuery.isLoading || (previewQuery.isFetching && !preview));
  const previewError =
    hasMultimodalDocument ? null : getApiErrorMessage(previewQuery.error) ?? preview?.error ?? null;
  const loadDataset = () => {
    datasetQuery.refetch();
  };
  const loadPreview = () => {
    previewQuery.refetch();
  };

  // UI state
  const [activeTab, setActiveTab] = useState("overview");

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">{t("datasets.detail.loading")}</p>
      </div>
    );
  }

  // Error state
  if (error || !dataset) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <AlertCircle className="h-8 w-8 text-destructive mb-4" />
        <p className="text-destructive font-medium mb-2">{t("datasets.detail.error")}</p>
        <p className="text-sm text-muted-foreground mb-4 text-center max-w-md">
          {error || t("datasets.detail.notFound")}
        </p>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => navigate("/datasets")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t("datasets.detail.goBack")}
          </Button>
          <Button onClick={loadDataset}>
            <RefreshCw className="h-4 w-4 mr-2" />
            {t("common.refresh")}
          </Button>
        </div>
      </div>
    );
  }

  if (hasMultimodalDocument && !multimodal) {
    return <div role="alert" className="space-y-4 py-16 text-center">
      <p className="text-destructive">{t("datasets.detailPage.multimodalUnavailable")}</p>
      <Button variant="outline" onClick={() => navigate("/datasets")}>{t("datasets.detailPage.backToDatasets")}</Button>
    </div>;
  }

  const repetitionColumn = getConfiguredRepetitionColumn(dataset.config);
  const repetitionColumnWarning = getRepeatIndexColumnWarning(repetitionColumn);
  const taskLabel = getDatasetTaskLabel(dataset.task_type, t, {
    numClasses: dataset.num_classes,
    fallback: t("datasets.task.auto"),
  });

  const statCards = [
    {
      title: t("datasets.info.samples"),
      icon: Layers,
      value: formatNumber(multimodal?.samples ?? dataset.num_samples),
      detail: (() => {
        if (multimodal) {
          return Object.entries(multimodal.partitions)
            .map(([name, count]) => `${formatNumber(count)} ${name}`)
            .join(" · ") || t("datasets.detailPage.stats.noPartitions");
        }
        const trainCount = preview?.summary?.train_samples ?? dataset.train_samples;
        const testCount = preview?.summary?.test_samples ?? dataset.test_samples;
        if (testCount != null && testCount > 0) {
          return t("datasets.detailPage.stats.trainTest", { train: formatNumber(trainCount), test: formatNumber(testCount) });
        }
        return t("datasets.detailPage.stats.allSamples");
      })(),
    },
    {
      title: multimodal ? t("datasets.detailPage.stats.sources") : t("datasets.info.features"),
      icon: Hash,
      value: multimodal ? String(multimodal.sources.length) : formatNumber(dataset.num_features),
      detail: multimodal ? t("datasets.detailPage.stats.typedSources") : preview?.summary?.header_unit
        ? t("datasets.detailPage.stats.headerUnit", { unit: preview.summary.header_unit })
        : t("datasets.detailPage.stats.featureCount"),
    },
    {
      title: multimodal ? t("datasets.detailPage.stats.alignment") : t("datasets.info.spectralRange"),
      icon: BarChart3,
      value: multimodal ? multimodal.alignment : preview?.spectra_preview
        ? `${Math.min(...preview.spectra_preview.wavelengths).toFixed(0)}-${Math.max(...preview.spectra_preview.wavelengths).toFixed(0)}`
        : "--",
      detail: multimodal ? t("datasets.detailPage.stats.declaredAlignment") : preview?.summary?.signal_type ?? t("datasets.detailPage.stats.previewPending"),
    },
    {
      title: t("datasets.info.targets"),
      icon: Target,
      value: String(multimodal?.targets.length ?? dataset.targets?.length ?? 0),
      detail: multimodal?.targets.join(", ") || dataset.default_target || t("datasets.detailPage.stats.noDefaultTarget"),
    },
  ];

  return (
    <MlLoadingOverlay>
    <motion.div
      className="mx-auto w-full max-w-7xl space-y-6 pb-6"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Back Link */}
      <motion.div variants={itemVariants}>
        <Link
          to="/datasets"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("datasets.detailPage.backToDatasets")}
        </Link>
      </motion.div>

      {/* Header */}
      <motion.div variants={itemVariants}>
        <Card className="overflow-hidden border-border/70 bg-card/80 shadow-sm">
          <CardContent className="space-y-6 p-5 sm:p-6">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
              <div className="flex min-w-0 items-start gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
                  <FileSpreadsheet className="h-7 w-7 text-primary" />
                </div>
                <div className="min-w-0 space-y-3">
                  <div className="space-y-1">
                    <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                      {dataset.name}
                    </h1>
                    <p
                      className="max-w-3xl truncate text-sm font-mono text-muted-foreground"
                      title={dataset.path}
                    >
                      {dataset.path}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="capitalize">
                      {taskLabel}
                    </Badge>
                    {dataset.default_target && (
                      <Badge variant="secondary">
                        {t("datasets.detailPage.defaultTarget", { name: dataset.default_target })}
                      </Badge>
                    )}
                    {repetitionColumn && (
                      <Badge variant="outline">
                        {t("datasets.detailPage.repetition", { column: repetitionColumn })}
                      </Badge>
                    )}
                    {repetitionColumnWarning && (
                      <Badge variant="destructive">
                        {t("datasets.detailPage.repetitionNeedsReview")}
                      </Badge>
                    )}
                    {Array.from(new Set(dataset.signal_types ?? [])).map((signalType) => (
                      <Badge key={signalType} variant="outline" className="capitalize">
                        {signalType}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                {!hasMultimodalDocument && <Button variant="outline" onClick={loadPreview} disabled={previewLoading}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${previewLoading ? "animate-spin" : ""}`} />
                  {t("datasets.detailPage.refreshPreview")}
                </Button>}
                {!hasMultimodalDocument && <Button variant="outline" asChild>
                  <Link
                    to={`/playground?datasetId=${encodeURIComponent(dataset.id)}&datasetName=${encodeURIComponent(dataset.name)}`}
                  >
                    <Play className="mr-2 h-4 w-4" />
                    {t("datasets.detailPage.openPlayground")}
                  </Link>
                </Button>}
                <Button asChild>
                  <Link to={`/editor?dataset=${encodeURIComponent(dataset.id)}`}>
                    <FlaskConical className="mr-2 h-4 w-4" />
                    {t("datasets.startExperiment")}
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link to="/datasets">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    {t("datasets.detailPage.backToLibrary")}
                  </Link>
                </Button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {statCards.map(({ title, icon: Icon, value, detail }) => (
                <div
                  key={title}
                  className="rounded-2xl border border-border/60 bg-muted/20 px-4 py-3"
                >
                  <div className="mb-2 flex items-center gap-2 text-muted-foreground">
                    <Icon className="h-4 w-4" />
                    <p className="text-sm">{title}</p>
                  </div>
                  <p className="text-2xl font-bold text-foreground">{value}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {previewError && !previewLoading && (
        <motion.div variants={itemVariants} role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <p className="font-medium">{t("datasets.detailPage.previewFailed")}</p>
          </div>
          <p className="mt-2 text-sm">{previewError}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={loadPreview}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t("datasets.detailPage.retryPreview")}
          </Button>
        </motion.div>
      )}

      {/* Tabs */}
      <motion.div variants={itemVariants}>
        <Tabs value={multimodal ? "overview" : activeTab} onValueChange={setActiveTab}>
          <Card className="border-border/70 bg-card/70 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t("datasets.detailPage.views")}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <TabsList className={`grid h-auto w-full gap-2 rounded-xl bg-muted/30 p-2 ${multimodal ? "grid-cols-1" : "grid-cols-2 lg:grid-cols-4"}`}>
                <TabsTrigger value="overview" className="gap-2 rounded-lg py-2.5">
                  <Info className="h-4 w-4" />
                  {t("datasets.detail.tabs.overview")}
                </TabsTrigger>
                {!multimodal && <>
                <TabsTrigger value="spectra" className="gap-2 rounded-lg py-2.5">
                  <BarChart3 className="h-4 w-4" />
                  {t("datasets.detail.tabs.spectra")}
                </TabsTrigger>
                <TabsTrigger value="targets" className="gap-2 rounded-lg py-2.5">
                  <Target className="h-4 w-4" />
                  {t("datasets.detail.tabs.targets")}
                </TabsTrigger>
                <TabsTrigger value="data" className="gap-2 rounded-lg py-2.5">
                  <Table className="h-4 w-4" />
                  {t("datasets.detail.tabs.rawData")}
                </TabsTrigger>
                </>}
              </TabsList>
            </CardContent>
          </Card>

          <div className="mt-6">
            <TabsContent value="overview" className="m-0">
              {multimodal ? <MultimodalDatasetOverview summary={multimodal} />
                : <DatasetOverviewTab dataset={dataset} preview={preview} />}
            </TabsContent>

            {!multimodal && <>
            <TabsContent value="spectra" className="m-0">
              <DatasetSpectraTab
                preview={preview}
                loading={previewLoading}
                error={previewError}
                onRefresh={loadPreview}
              />
            </TabsContent>

            <TabsContent value="targets" className="m-0">
              <DatasetTargetsTab
                dataset={dataset}
                preview={preview}
                loading={previewLoading}
                error={previewError}
                onRefresh={loadPreview}
              />
            </TabsContent>

            <TabsContent value="data" className="m-0">
              <DatasetRawDataTab
                dataset={dataset}
                preview={preview}
                loading={previewLoading}
                error={previewError}
                onRefresh={loadPreview}
              />
            </TabsContent>
            </>}
          </div>
        </Tabs>
      </motion.div>
    </motion.div>
    </MlLoadingOverlay>
  );
}
