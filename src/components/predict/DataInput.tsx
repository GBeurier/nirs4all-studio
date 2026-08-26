import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ClipboardPaste,
  Database,
  FileSpreadsheet,
  Loader2,
  Play,
  Upload,
} from "lucide-react";

import { useDatasetsQuery } from "@/hooks/useDatasetQueries";
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
import { cn } from "@/lib/utils";
import type { AvailableModel } from "@/types/predict";
import {
  DATA_INPUT_FIELD_LABELS,
  DATA_INPUT_FILE_ACCEPT,
  DATA_INPUT_PARTITION_HINT,
  DATA_INPUT_PARTITION_OPTIONS,
  DEFAULT_DATA_INPUT_PARTITION,
  DEFAULT_DATA_INPUT_TAB,
  buildDataInputDatasetReadModel,
  buildDataInputFileReadModel,
  buildDataInputModelReadModel,
  buildDataInputSourceTabs,
  buildDataSourceConfig,
  getDataInputCanSubmit,
  isAcceptedDataInputFile,
} from "./DataInputData";
import type { DataInputSourceIcon, DataInputTab, DataSourceConfig } from "./DataInputData";

export type { DataSourceConfig } from "./DataInputData";

interface DataInputProps {
  model: AvailableModel | null;
  isLoading: boolean;
  onRunPrediction: (config: DataSourceConfig) => void;
}

const SOURCE_ICONS: Record<DataInputSourceIcon, typeof Database> = {
  dataset: Database,
  upload: Upload,
  paste: ClipboardPaste,
};

export function DataInput({ model, isLoading, onRunPrediction }: DataInputProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<DataInputTab>(DEFAULT_DATA_INPUT_TAB);
  const [datasetId, setDatasetId] = useState("");
  const [partition, setPartition] = useState(DEFAULT_DATA_INPUT_PARTITION);
  const [file, setFile] = useState<File | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Shared dataset cache (see src/hooks/useDatasetQueries.ts) — instant on
  // mount, persisted to localStorage, refreshed in the background, and
  // invalidated by any dataset mutation app-wide.
  const { data: datasetsData } = useDatasetsQuery();
  const datasets = datasetsData?.datasets ?? [];
  const isModelSelected = model != null;
  const sourceTabs = buildDataInputSourceTabs(isModelSelected, model?.source);
  const modelReadModel = buildDataInputModelReadModel(model);
  const datasetReadModel = buildDataInputDatasetReadModel(datasets);
  const fileReadModel = buildDataInputFileReadModel(file);
  const canSubmit = getDataInputCanSubmit({
    isModelSelected,
    modelSource: model?.source,
    isLoading,
    tab,
    datasetId,
    file,
    pasteText,
  });

  useEffect(() => {
    if (model?.source === "native_archive") {
      setTab("upload");
    }
  }, [model?.source]);

  const handleFileDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const dropped = event.dataTransfer.files[0];
    if (isAcceptedDataInputFile(dropped)) {
      setFile(dropped);
    }
  }, []);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (isAcceptedDataInputFile(selected)) {
      setFile(selected);
    }
  }, []);

  const handleSubmit = () => {
    if (!model) return;

    const result = buildDataSourceConfig({
      tab,
      datasetId,
      partition,
      file,
      pasteText,
    });
    if (!result.ok) {
      if (result.reason === "invalid-paste") {
        setPasteError(t("predict.data.paste.invalid"));
      }
      return;
    }

    setPasteError(null);
    onRunPrediction(result.config);
  };

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="space-y-4">
        <div>
          <CardTitle>{t("predict.data.title")}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {model?.source === "native_archive"
              ? t("predict.data.nativeArchive.description", {
                  defaultValue: "Native archives require an uploaded CSV or Excel file with a non-numeric stable sample-ID column.",
                })
              : t("predict.data.description")}
          </p>
        </div>

        <div className="rounded-xl border bg-muted/30 p-4">
          {modelReadModel.isSelected ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {modelReadModel.badges.map((badge) => (
                  <Badge key={badge.key} variant={badge.variant}>
                    {badge.label}
                  </Badge>
                ))}
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">{modelReadModel.title}</p>
                <p className="text-sm text-muted-foreground">
                  {modelReadModel.description}
                </p>
              </div>
              {modelReadModel.pills.length > 0 && (
                <div className="flex flex-wrap gap-2 text-xs">
                  {modelReadModel.pills.map((pill) => (
                    <span key={pill.key} className={pill.className}>
                      {pill.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-sm font-medium">{modelReadModel.title}</p>
              <p className="text-sm text-muted-foreground">
                {modelReadModel.description}
              </p>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <Tabs value={tab} onValueChange={(value) => setTab(value as DataInputTab)}>
          <TabsList
            className="grid w-full"
            style={{ gridTemplateColumns: `repeat(${sourceTabs.length}, minmax(0, 1fr))` }}
          >
            {sourceTabs.map((source) => {
              const Icon = SOURCE_ICONS[source.icon];
              return (
                <TabsTrigger key={source.id} value={source.id} className="gap-1.5" disabled={source.disabled}>
                  <Icon className="h-3.5 w-3.5" />
                  {t(source.labelKey)}
                </TabsTrigger>
              );
            })}
          </TabsList>

          <TabsContent value="dataset" className="mt-4">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {DATA_INPUT_FIELD_LABELS.dataset}
                </p>
                <Select value={datasetId} onValueChange={setDatasetId} disabled={!isModelSelected}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("predict.data.dataset.select")} />
                  </SelectTrigger>
                  <SelectContent>
                    {datasetReadModel.options.map((dataset) => (
                      <SelectItem key={dataset.id} value={dataset.id}>
                        {dataset.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {datasetReadModel.availabilityLabel}
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {DATA_INPUT_FIELD_LABELS.partition}
                </p>
                <Select value={partition} onValueChange={setPartition} disabled={!isModelSelected}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DATA_INPUT_PARTITION_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.labelKey ? t(option.labelKey) : option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {DATA_INPUT_PARTITION_HINT}
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
                accept={DATA_INPUT_FILE_ACCEPT}
                onChange={handleFileSelect}
                className="hidden"
                disabled={!isModelSelected}
              />

              {fileReadModel ? (
                <div className="space-y-2">
                  <FileSpreadsheet className="mx-auto h-8 w-8 text-primary" />
                  <p className="font-medium">{fileReadModel.name}</p>
                  <Badge variant="secondary">{fileReadModel.sizeLabel}</Badge>
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

        <Button onClick={handleSubmit} disabled={!canSubmit} className="w-full" size="lg">
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
