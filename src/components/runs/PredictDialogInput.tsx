import { useCallback, useState, type DragEvent } from "react";
import { CheckCircle2, Database, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useDatasetsQuery } from "@/hooks/useDatasetQueries";
import { cn } from "@/lib/utils";

import type { PredictInputMode } from "./PredictDialogData";

interface PredictDialogInputProps {
  inputMode: PredictInputMode;
  onInputModeChange: (mode: PredictInputMode) => void;
  pasteData: string;
  onPasteDataChange: (value: string) => void;
  selectedDataset: string;
  onDatasetSelect: (id: string) => void;
  selectedPartition: string;
  onPartitionChange: (partition: string) => void;
}

function PasteInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-2">
      <Label>{t("runs.predict.pasteLabel")}</Label>
      <Textarea
        placeholder={t("runs.predict.pastePlaceholder")}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-[200px] font-mono text-xs"
      />
      <p className="text-xs text-muted-foreground">
        {t("runs.predict.pasteHint")}
      </p>
    </div>
  );
}

function FileUpload({ onFileLoad }: { onFileLoad: (data: string) => void }) {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.name.match(/\.(csv|txt|tsv)$/i)) {
        toast.error(t("runs.predict.invalidFile"));
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        setFileName(file.name);
        onFileLoad(text);
      };
      reader.readAsText(file);
    },
    [onFileLoad, t]
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      const file = event.dataTransfer.files[0];
      if (file) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  return (
    <div className="space-y-2">
      <Label>{t("runs.predict.uploadLabel")}</Label>
      <div
        className={cn(
          "border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer",
          isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25",
          fileName && "border-chart-1 bg-chart-1/5"
        )}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => document.getElementById("file-input")?.click()}
      >
        <input
          id="file-input"
          type="file"
          accept=".csv,.txt,.tsv"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              handleFile(file);
            }
          }}
        />
        {fileName ? (
          <div className="flex flex-col items-center gap-2">
            <CheckCircle2 className="h-8 w-8 text-chart-1" />
            <p className="font-medium">{fileName}</p>
            <p className="text-xs text-muted-foreground">{t("runs.predict.changeFile")}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">{t("runs.predict.dropFile")}</p>
            <p className="text-xs text-muted-foreground">
              {t("runs.predict.supportedFiles")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function DatasetSelector({
  selectedDataset,
  onSelect,
  selectedPartition,
  onPartitionChange,
}: {
  selectedDataset: string;
  onSelect: (id: string) => void;
  selectedPartition: string;
  onPartitionChange: (partition: string) => void;
}) {
  const { t } = useTranslation();
  const { data: datasetsData, isLoading } = useDatasetsQuery();

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>{t("runs.predict.selectDataset")}</Label>
        <Select value={selectedDataset} onValueChange={onSelect}>
          <SelectTrigger>
            <SelectValue placeholder={t("runs.predict.chooseDataset")} />
          </SelectTrigger>
          <SelectContent>
            {isLoading ? (
              <div className="p-2 text-sm text-muted-foreground">{t("common.loading")}</div>
            ) : !datasetsData?.datasets?.length ? (
              <div className="p-2 text-sm text-muted-foreground">{t("runs.predict.noDatasets")}</div>
            ) : (
              datasetsData.datasets.map((dataset) => (
                <SelectItem key={dataset.id} value={dataset.id}>
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    <span>{dataset.name}</span>
                    {dataset.num_samples && (
                      <Badge variant="secondary" className="text-xs">
                        {t("runs.predict.sampleCount", { count: dataset.num_samples })}
                      </Badge>
                    )}
                  </div>
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>

      {selectedDataset && (
        <div className="space-y-2">
          <Label>{t("runs.predict.partition")}</Label>
          <Select value={selectedPartition} onValueChange={onPartitionChange}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="test">{t("runs.quickView.partitions.test")}</SelectItem>
              <SelectItem value="train">{t("runs.quickView.partitions.train")}</SelectItem>
              <SelectItem value="all">{t("common.all")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

export function PredictDialogInput({
  inputMode,
  onInputModeChange,
  pasteData,
  onPasteDataChange,
  selectedDataset,
  onDatasetSelect,
  selectedPartition,
  onPartitionChange,
}: PredictDialogInputProps) {
  const { t } = useTranslation();

  return (
    <Tabs
      value={inputMode}
      onValueChange={(value) => onInputModeChange(value as PredictInputMode)}
    >
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="paste" className="text-xs">
          <FileSpreadsheet className="h-4 w-4 mr-1.5" />
          {t("runs.predict.tabPaste")}
        </TabsTrigger>
        <TabsTrigger value="upload" className="text-xs">
          <Upload className="h-4 w-4 mr-1.5" />
          {t("runs.predict.tabUpload")}
        </TabsTrigger>
        <TabsTrigger value="dataset" className="text-xs">
          <Database className="h-4 w-4 mr-1.5" />
          {t("runs.predict.tabDataset")}
        </TabsTrigger>
      </TabsList>

      <div className="mt-4 min-h-[250px]">
        <TabsContent value="paste" className="m-0">
          <PasteInput value={pasteData} onChange={onPasteDataChange} />
        </TabsContent>

        <TabsContent value="upload" className="m-0">
          <FileUpload onFileLoad={onPasteDataChange} />
        </TabsContent>

        <TabsContent value="dataset" className="m-0">
          <DatasetSelector
            selectedDataset={selectedDataset}
            onSelect={onDatasetSelect}
            selectedPartition={selectedPartition}
            onPartitionChange={onPartitionChange}
          />
        </TabsContent>
      </div>
    </Tabs>
  );
}
