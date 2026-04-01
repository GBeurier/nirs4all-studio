import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  ClipboardPaste,
  Database,
  FileSpreadsheet,
  Loader2,
  Play,
  Upload,
} from "lucide-react";

import { listDatasets } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { getPredictionMetricLabel } from "@/lib/predict-metrics";
import { formatMetricValue } from "@/lib/scores";
import { cn } from "@/lib/utils";
import type { AvailableModel } from "@/types/predict";

export type DataSourceConfig =
  | { type: "dataset"; datasetId: string; partition: string }
  | { type: "file"; file: File }
  | { type: "array"; spectra: number[][] };

interface DataInputProps {
  model: AvailableModel | null;
  isLoading: boolean;
  onRunPrediction: (config: DataSourceConfig) => void;
}

export function DataInput({ model, isLoading, onRunPrediction }: DataInputProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState("dataset");
  const [datasetId, setDatasetId] = useState("");
  const [partition, setPartition] = useState("test");
  const [file, setFile] = useState<File | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: datasetsData } = useQuery({
    queryKey: ["datasets-list"],
    queryFn: () => listDatasets(),
    staleTime: 30000,
  });

  const datasets = datasetsData?.datasets ?? [];
  const isModelSelected = model != null;

  const handleFileDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const dropped = event.dataTransfer.files[0];
    if (
      dropped &&
      (dropped.name.endsWith(".csv") ||
        dropped.name.endsWith(".xlsx") ||
        dropped.name.endsWith(".xls"))
    ) {
      setFile(dropped);
    }
  }, []);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (selected) {
      setFile(selected);
    }
  }, []);

  const parsePasteData = useCallback((): number[][] | null => {
    const text = pasteText.trim();
    if (!text) return null;

    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.length > 0) {
        if (Array.isArray(parsed[0])) return parsed as number[][];
        if (typeof parsed[0] === "number") return [parsed as number[]];
      }
    } catch {
      // Fall through to plain text parsing.
    }

    const lines = text.split("\n").filter((line) => line.trim());
    const rows: number[][] = [];

    for (const line of lines) {
      const values = line.split(/[,;\t]+/).map((value) => parseFloat(value.trim()));
      if (values.some(Number.isNaN)) return null;
      rows.push(values);
    }

    return rows.length > 0 ? rows : null;
  }, [pasteText]);

  const canSubmit = () => {
    if (!isModelSelected || isLoading) return false;
    if (tab === "dataset") return Boolean(datasetId);
    if (tab === "upload") return Boolean(file);
    if (tab === "paste") return Boolean(pasteText.trim());
    return false;
  };

  const handleSubmit = () => {
    if (!model) return;

    if (tab === "dataset") {
      onRunPrediction({ type: "dataset", datasetId, partition });
      return;
    }

    if (tab === "upload" && file) {
      onRunPrediction({ type: "file", file });
      return;
    }

    if (tab === "paste") {
      const spectra = parsePasteData();
      if (!spectra) {
        setPasteError(t("predict.data.paste.invalid"));
        return;
      }
      setPasteError(null);
      onRunPrediction({ type: "array", spectra });
    }
  };

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="space-y-4">
        <div>
          <CardTitle>{t("predict.data.title")}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("predict.data.description")}
          </p>
        </div>

        <div className="rounded-xl border bg-muted/30 p-4">
          {model ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{model.source}</Badge>
                <Badge variant="secondary">{model.model_class || model.name}</Badge>
                {model.dataset_name && <Badge variant="outline">{model.dataset_name}</Badge>}
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">{model.name}</p>
                <p className="text-sm text-muted-foreground">
                  Input data will be replayed through this trained model path.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {model.prediction_score != null && model.prediction_metric && (
                  <span className="rounded-full bg-background px-2.5 py-1 font-medium text-foreground">
                    {getPredictionMetricLabel(model.prediction_metric)}{" "}
                    {formatMetricValue(model.prediction_score, model.prediction_metric)}
                  </span>
                )}
                {model.preprocessing && (
                  <span className="rounded-full bg-background px-2.5 py-1 text-muted-foreground">
                    {model.preprocessing}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-sm font-medium">Model required</p>
              <p className="text-sm text-muted-foreground">
                Select a trained model on the left before choosing data.
              </p>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="dataset" className="gap-1.5" disabled={!isModelSelected}>
              <Database className="h-3.5 w-3.5" />
              {t("predict.data.tabs.dataset")}
            </TabsTrigger>
            <TabsTrigger value="upload" className="gap-1.5" disabled={!isModelSelected}>
              <Upload className="h-3.5 w-3.5" />
              {t("predict.data.tabs.upload")}
            </TabsTrigger>
            <TabsTrigger value="paste" className="gap-1.5" disabled={!isModelSelected}>
              <ClipboardPaste className="h-3.5 w-3.5" />
              {t("predict.data.tabs.paste")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dataset" className="mt-4">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Dataset
                </p>
                <Select value={datasetId} onValueChange={setDatasetId} disabled={!isModelSelected}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("predict.data.dataset.select")} />
                  </SelectTrigger>
                  <SelectContent>
                    {datasets.map((dataset) => (
                      <SelectItem key={dataset.id} value={dataset.id}>
                        {dataset.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {datasets.length} linked dataset{datasets.length === 1 ? "" : "s"} available.
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Partition
                </p>
                <Select value={partition} onValueChange={setPartition} disabled={!isModelSelected}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="test">Test</SelectItem>
                    <SelectItem value="train">Train</SelectItem>
                    <SelectItem value="all">{t("predict.data.dataset.allPartitions")}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Use `test` by default when you want the displayed RMSEP to stay comparable.
                </p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="upload" className="mt-4">
            <div
              className={cn(
                "cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors",
                isModelSelected
                  ? "hover:border-primary/50 hover:bg-muted/30"
                  : "cursor-not-allowed opacity-60",
              )}
              onDragOver={(event) => event.preventDefault()}
              onDrop={isModelSelected ? handleFileDrop : undefined}
              onClick={() => {
                if (isModelSelected) {
                  fileInputRef.current?.click();
                }
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileSelect}
                className="hidden"
                disabled={!isModelSelected}
              />

              {file ? (
                <div className="space-y-2">
                  <FileSpreadsheet className="mx-auto h-8 w-8 text-primary" />
                  <p className="font-medium">{file.name}</p>
                  <Badge variant="secondary">{(file.size / 1024).toFixed(1)} KB</Badge>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-medium">{t("predict.data.upload.dropzone")}</p>
                  <p className="text-xs text-muted-foreground">{t("predict.data.upload.browse")}</p>
                  <p className="text-xs text-muted-foreground">{t("predict.data.upload.formats")}</p>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="paste" className="mt-4 space-y-2">
            <Textarea
              placeholder={t("predict.data.paste.placeholder")}
              value={pasteText}
              onChange={(event) => {
                setPasteText(event.target.value);
                setPasteError(null);
              }}
              rows={8}
              className="font-mono text-xs"
              disabled={!isModelSelected}
            />
            <p className="text-xs text-muted-foreground">{t("predict.data.paste.hint")}</p>
            {pasteError && <p className="text-xs text-destructive">{pasteError}</p>}
          </TabsContent>
        </Tabs>

        <Button onClick={handleSubmit} disabled={!canSubmit()} className="w-full" size="lg">
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("predict.data.running")}
            </>
          ) : (
            <>
              <Play className="mr-2 h-4 w-4" />
              {isModelSelected ? t("predict.data.runPrediction") : "Select a model first"}
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
