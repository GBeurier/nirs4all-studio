/**
 * DatasetDetail - Full page view for a single dataset
 *
 * Provides comprehensive dataset information with tabs for:
 * - Overview: Summary, metadata, version info
 * - Spectra: Full spectral visualization
 * - Targets: Target distribution and statistics
 * - Raw Data: Paginated data table
 */
import { useState, useEffect, useCallback } from "react";
import { MlLoadingOverlay } from "@/components/layout/MlLoadingOverlay";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "@/lib/motion";
import {
  ArrowLeft,
  FileSpreadsheet,
  Download,
  Play,
  Settings,
  RefreshCw,
  Loader2,
  AlertCircle,
  BarChart3,
  Target,
  Table,
  Info,
  Layers,
  Hash,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DatasetOverviewTab,
  DatasetSpectraTab,
  DatasetTargetsTab,
  DatasetRawDataTab,
} from "@/components/datasets/detail";
import { getDataset, previewDatasetById } from "@/api/client";
import type { Dataset, PreviewDataResponse } from "@/types/datasets";

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
  return num.toLocaleString();
}

export default function DatasetDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // Data state
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [preview, setPreview] = useState<PreviewDataResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // UI state
  const [activeTab, setActiveTab] = useState("overview");

  // Load dataset
  const loadDataset = useCallback(async () => {
    if (!id) return;

    setLoading(true);
    setError(null);

    try {
      const { dataset } = await getDataset(id);
      setDataset(dataset);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load dataset";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Load preview data
  const loadPreview = useCallback(async () => {
    if (!dataset?.id) return;

    setPreviewLoading(true);
    setPreviewError(null);

    try {
      const result = await previewDatasetById(dataset.id, 100);
      setPreview(result);
      if (result.error) {
        setPreviewError(result.error);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load preview";
      setPreviewError(message);
    } finally {
      setPreviewLoading(false);
    }
  }, [dataset?.id]);

  // Load dataset on mount
  useEffect(() => {
    loadDataset();
  }, [loadDataset]);

  // Load preview when dataset is available
  useEffect(() => {
    if (dataset && !preview && !previewLoading) {
      loadPreview();
    }
  }, [dataset, preview, previewLoading, loadPreview]);

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

  return (
    <MlLoadingOverlay>
    <motion.div
      className="space-y-6"
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
          Back to Datasets
        </Link>
      </motion.div>

      {/* Header */}
      <motion.div variants={itemVariants}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl bg-primary/10">
              <FileSpreadsheet className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">{dataset.name}</h1>
              <p className="text-muted-foreground font-mono text-sm truncate max-w-lg" title={dataset.path}>
                {dataset.path}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate(`/datasets`)}>
              <Settings className="h-4 w-4 mr-2" />
              Edit
            </Button>
            <Button variant="outline">
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            <Button>
              <Play className="h-4 w-4 mr-2" />
              Run Analysis
            </Button>
          </div>
        </div>
      </motion.div>

      {/* Quick Stats */}
      <motion.div className="grid grid-cols-2 md:grid-cols-4 gap-4" variants={itemVariants}>
        <Card className="bg-card/50">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{t("datasets.info.samples")}</p>
            </div>
            <p className="text-2xl font-bold">{formatNumber(dataset.num_samples)}</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Hash className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{t("datasets.info.features")}</p>
            </div>
            <p className="text-2xl font-bold">{formatNumber(dataset.num_features)}</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{t("datasets.info.spectralRange")}</p>
            </div>
            <p className="text-2xl font-bold">
              {preview?.spectra_preview
                ? `${Math.min(...preview.spectra_preview.wavelengths).toFixed(0)}-${Math.max(...preview.spectra_preview.wavelengths).toFixed(0)}`
                : "--"}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Target className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{t("datasets.info.targets")}</p>
            </div>
            <p className="text-2xl font-bold">{dataset.targets?.length || 0}</p>
          </CardContent>
        </Card>
      </motion.div>

      {/* Tabs */}
      <motion.div variants={itemVariants}>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-muted/50">
            <TabsTrigger value="overview" className="gap-2">
              <Info className="h-4 w-4" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="spectra" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              Spectra
            </TabsTrigger>
            <TabsTrigger value="targets" className="gap-2">
              <Target className="h-4 w-4" />
              Targets
            </TabsTrigger>
            <TabsTrigger value="data" className="gap-2">
              <Table className="h-4 w-4" />
              Raw Data
            </TabsTrigger>
          </TabsList>

          <div className="mt-6">
            <TabsContent value="overview" className="m-0">
              <DatasetOverviewTab dataset={dataset} preview={preview} />
            </TabsContent>

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
          </div>
        </Tabs>
      </motion.div>
    </motion.div>
    </MlLoadingOverlay>
  );
}
