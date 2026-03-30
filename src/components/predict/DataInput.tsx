import { useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Upload, FileSpreadsheet, Database, ClipboardPaste, Loader2, Play } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listDatasets } from "@/api/client";
import type { AvailableModel } from "@/types/predict";

export type DataSourceConfig =
  | { type: "dataset"; datasetId: string; partition: string }
  | { type: "file"; file: File }
  | { type: "array"; spectra: number[][] };

interface DataInputProps {
  model: AvailableModel;
  isLoading: boolean;
  onRunPrediction: (config: DataSourceConfig) => void;
}

export function DataInput({ model, isLoading, onRunPrediction }: DataInputProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState("dataset");
  const [datasetId, setDatasetId] = useState("");
  const [partition, setPartition] = useState("all");
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

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files[0];
    if (dropped && (dropped.name.endsWith(".csv") || dropped.name.endsWith(".xlsx") || dropped.name.endsWith(".xls"))) {
      setFile(dropped);
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) setFile(selected);
  }, []);

  const parsePasteData = useCallback((): number[][] | null => {
    const text = pasteText.trim();
    if (!text) return null;

    // Try JSON array first
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.length > 0) {
        if (Array.isArray(parsed[0])) return parsed;
        if (typeof parsed[0] === "number") return [parsed];
      }
    } catch {
      // Not JSON — try CSV parsing
    }

    // Parse as CSV (comma, tab, or semicolon separated)
    const lines = text.split("\n").filter((l) => l.trim());
    const rows: number[][] = [];
    for (const line of lines) {
      const parts = line.split(/[,;\t]+/).map((v) => parseFloat(v.trim()));
      if (parts.some(isNaN)) return null;
      rows.push(parts);
    }
    return rows.length > 0 ? rows : null;
  }, [pasteText]);

  const canSubmit = () => {
    if (isLoading) return false;
    if (tab === "dataset") return !!datasetId;
    if (tab === "upload") return !!file;
    if (tab === "paste") return !!pasteText.trim();
    return false;
  };

  const handleSubmit = () => {
    if (tab === "dataset") {
      onRunPrediction({ type: "dataset", datasetId, partition });
    } else if (tab === "upload" && file) {
      onRunPrediction({ type: "file", file });
    } else if (tab === "paste") {
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
    <Card>
      <CardHeader>
        <CardTitle>{t("predict.data.title")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("predict.data.description")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="dataset" className="gap-1.5">
              <Database className="h-3.5 w-3.5" />
              {t("predict.data.tabs.dataset")}
            </TabsTrigger>
            <TabsTrigger value="upload" className="gap-1.5">
              <Upload className="h-3.5 w-3.5" />
              {t("predict.data.tabs.upload")}
            </TabsTrigger>
            <TabsTrigger value="paste" className="gap-1.5">
              <ClipboardPaste className="h-3.5 w-3.5" />
              {t("predict.data.tabs.paste")}
            </TabsTrigger>
          </TabsList>

          {/* Dataset tab */}
          <TabsContent value="dataset" className="space-y-3 mt-4">
            <div className="space-y-2">
              <Select value={datasetId} onValueChange={setDatasetId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("predict.data.dataset.select")} />
                </SelectTrigger>
                <SelectContent>
                  {datasets.map((ds) => (
                    <SelectItem key={ds.id} value={ds.id}>
                      {ds.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={partition} onValueChange={setPartition}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("predict.data.dataset.allPartitions")}</SelectItem>
                  <SelectItem value="train">Train</SelectItem>
                  <SelectItem value="test">Test</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </TabsContent>

          {/* Upload tab */}
          <TabsContent value="upload" className="mt-4">
            <div
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors hover:border-primary/50 hover:bg-muted/30"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileSelect}
                className="hidden"
              />
              {file ? (
                <div className="space-y-2">
                  <FileSpreadsheet className="h-8 w-8 mx-auto text-primary" />
                  <p className="font-medium">{file.name}</p>
                  <Badge variant="secondary">
                    {(file.size / 1024).toFixed(1)} KB
                  </Badge>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                  <p className="text-sm font-medium">{t("predict.data.upload.dropzone")}</p>
                  <p className="text-xs text-muted-foreground">{t("predict.data.upload.browse")}</p>
                  <p className="text-xs text-muted-foreground">{t("predict.data.upload.formats")}</p>
                </div>
              )}
            </div>
          </TabsContent>

          {/* Paste tab */}
          <TabsContent value="paste" className="space-y-2 mt-4">
            <Textarea
              placeholder={t("predict.data.paste.placeholder")}
              value={pasteText}
              onChange={(e) => {
                setPasteText(e.target.value);
                setPasteError(null);
              }}
              rows={6}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">{t("predict.data.paste.hint")}</p>
            {pasteError && (
              <p className="text-xs text-destructive">{pasteError}</p>
            )}
          </TabsContent>
        </Tabs>

        <Button
          onClick={handleSubmit}
          disabled={!canSubmit()}
          className="w-full"
          size="lg"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              {t("predict.data.running")}
            </>
          ) : (
            <>
              <Play className="h-4 w-4 mr-2" />
              {t("predict.data.runPrediction")}
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
