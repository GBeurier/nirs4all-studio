import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Info, FolderOpen } from "lucide-react";
import { getDatasetTaskLabel } from "@/lib/datasetTask";
import type { Dataset, DatasetConfig } from "@/types/datasets";
import { getActiveLocale } from "@/lib/activeLocale";

interface EditDatasetModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dataset: Dataset | null;
  onSave: (datasetId: string, config: Partial<DatasetConfig>) => Promise<void>;
}

export function EditDatasetModal({
  open,
  onOpenChange,
  dataset,
  onSave,
}: EditDatasetModalProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  // Config state
  const [delimiter, setDelimiter] = useState(";");
  const [decimalSeparator, setDecimalSeparator] = useState(".");
  const [headerType, setHeaderType] = useState<string>("text");

  // File paths (optional overrides)
  const [trainXPath, setTrainXPath] = useState("");
  const [trainYPath, setTrainYPath] = useState("");
  const [testXPath, setTestXPath] = useState("");
  const [testYPath, setTestYPath] = useState("");
  const [trainGroupPath, setTrainGroupPath] = useState("");
  const [testGroupPath, setTestGroupPath] = useState("");

  // Load existing config when dataset changes
  useEffect(() => {
    if (dataset?.config) {
      const cfg = dataset.config;
      setDelimiter(cfg.delimiter || ";");
      setDecimalSeparator(cfg.decimal_separator || ".");
      setHeaderType(
        cfg.has_header === false
          ? "none"
          : cfg.header_type || "text"
      );
      setTrainXPath(cfg.train_x || "");
      setTrainYPath(cfg.train_y || "");
      setTestXPath(cfg.test_x || "");
      setTestYPath(cfg.test_y || "");
      setTrainGroupPath(cfg.train_group || "");
      setTestGroupPath(cfg.test_group || "");
    } else {
      // Reset to defaults
      setDelimiter(";");
      setDecimalSeparator(".");
      setHeaderType("text");
      setTrainXPath("");
      setTrainYPath("");
      setTestXPath("");
      setTestYPath("");
      setTrainGroupPath("");
      setTestGroupPath("");
    }
  }, [dataset]);

  const handleSave = async () => {
    if (!dataset) return;

    setLoading(true);
    try {
      const config: Partial<DatasetConfig> = {
        delimiter,
        decimal_separator: decimalSeparator,
        has_header: headerType !== "none",
        header_type: headerType as DatasetConfig["header_type"],
      };

      // Add file paths if specified
      if (trainXPath) config.train_x = trainXPath;
      if (trainYPath) config.train_y = trainYPath;
      if (testXPath) config.test_x = testXPath;
      if (testYPath) config.test_y = testYPath;
      if (trainGroupPath) config.train_group = trainGroupPath;
      if (testGroupPath) config.test_group = testGroupPath;

      await onSave(dataset.id, config);
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to save dataset config:", error);
    } finally {
      setLoading(false);
    }
  };

  if (!dataset) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("datasets.editModal.title")}</DialogTitle>
          <DialogDescription>{dataset.name}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Path (read-only) */}
          <div>
            <Label className="text-sm text-muted-foreground">
              {t("datasets.editModal.path")}
            </Label>
            <div className="mt-1 flex items-center gap-2">
              <Input
                value={dataset.path}
                readOnly
                className="flex-1 bg-muted/50 font-mono text-sm"
              />
              <Button
                variant="outline"
                size="icon"
                aria-label={t("datasets.card.openFolder")}
                onClick={() => {
                  if (dataset.path) {
                    window.open(`file://${dataset.path}`, "_blank");
                  }
                }}
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("datasets.editModal.pathHint")}
            </p>
          </div>

          {/* CSV Parsing Options */}
          <div className="border-t pt-4">
            <Label className="text-base font-medium">{t("datasets.editModal.csvOptions")}</Label>
            <div className="grid grid-cols-3 gap-4 mt-4">
              <div>
                <Label className="text-sm text-muted-foreground">
                  {t("datasets.editModal.delimiter")}
                </Label>
                <Select value={delimiter} onValueChange={setDelimiter}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value=";">{t("datasets.editModal.semicolon")}</SelectItem>
                    <SelectItem value=",">{t("datasets.editModal.comma")}</SelectItem>
                    <SelectItem value="\t">{t("datasets.editModal.tab")}</SelectItem>
                    <SelectItem value="|">{t("datasets.editModal.pipe")}</SelectItem>
                    <SelectItem value=" ">{t("datasets.editModal.space")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-sm text-muted-foreground">
                  {t("datasets.editModal.decimalSeparator")}
                </Label>
                <Select
                  value={decimalSeparator}
                  onValueChange={setDecimalSeparator}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value=".">{t("datasets.editModal.dot")}</SelectItem>
                    <SelectItem value=",">{t("datasets.editModal.comma")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-sm text-muted-foreground">{t("datasets.editModal.header")}</Label>
                <Select value={headerType} onValueChange={setHeaderType}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("common.none")}</SelectItem>
                    <SelectItem value="nm">{t("datasets.editModal.headerWavelength")}</SelectItem>
                    <SelectItem value="cm-1">{t("datasets.editModal.headerWavenumber")}</SelectItem>
                    <SelectItem value="text">{t("datasets.editModal.headerText")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* File Path Configuration */}
          <div className="border-t pt-4">
            <Label className="text-base font-medium">
              {t("datasets.editModal.filePaths")}
            </Label>
            <p className="text-sm text-muted-foreground mt-1 mb-4">
              {t("datasets.editModal.filePathsHint")}
            </p>

            <div className="space-y-4">
              {/* Training Data */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm text-muted-foreground">
                    {t("datasets.editModal.trainX")}
                  </Label>
                  <Input
                    value={trainXPath}
                    onChange={(e) => setTrainXPath(e.target.value)}
                    placeholder={t("datasets.editModal.placeholder", { file: "Xcal.csv" })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground">
                    {t("datasets.editModal.trainY")}
                  </Label>
                  <Input
                    value={trainYPath}
                    onChange={(e) => setTrainYPath(e.target.value)}
                    placeholder={t("datasets.editModal.placeholder", { file: "Ycal.csv" })}
                    className="mt-1"
                  />
                </div>
              </div>

              {/* Test Data */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm text-muted-foreground">
                    {t("datasets.editModal.testX")}
                  </Label>
                  <Input
                    value={testXPath}
                    onChange={(e) => setTestXPath(e.target.value)}
                    placeholder={t("datasets.editModal.placeholder", { file: "Xval.csv" })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground">
                    {t("datasets.editModal.testY")}
                  </Label>
                  <Input
                    value={testYPath}
                    onChange={(e) => setTestYPath(e.target.value)}
                    placeholder={t("datasets.editModal.placeholder", { file: "Yval.csv" })}
                    className="mt-1"
                  />
                </div>
              </div>

              {/* Group/Metadata Data */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm text-muted-foreground">
                    {t("datasets.editModal.trainGroups")}
                  </Label>
                  <Input
                    value={trainGroupPath}
                    onChange={(e) => setTrainGroupPath(e.target.value)}
                    placeholder={t("datasets.editModal.placeholder", { file: "Gcal.csv" })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground">
                    {t("datasets.editModal.testGroups")}
                  </Label>
                  <Input
                    value={testGroupPath}
                    onChange={(e) => setTestGroupPath(e.target.value)}
                    placeholder={t("datasets.editModal.placeholder", { file: "Gval.csv" })}
                    className="mt-1"
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 p-3 bg-muted/50 rounded-lg flex items-start gap-2">
              <Info className="h-4 w-4 text-muted-foreground mt-0.5" />
              <p className="text-sm text-muted-foreground">
                {t("datasets.editModal.pathsNote")}
              </p>
            </div>
          </div>

          {/* Dataset Info */}
          {dataset.num_samples !== undefined && (
            <div className="border-t pt-4">
              <Label className="text-base font-medium">{t("datasets.editModal.datasetInfo")}</Label>
              <div className="grid grid-cols-3 gap-4 mt-3">
                <div className="p-3 bg-muted/30 rounded-lg">
                  <p className="text-sm text-muted-foreground">{t("datasets.info.samples")}</p>
                  <p className="text-lg font-semibold">
                    {dataset.num_samples?.toLocaleString(getActiveLocale()) ?? "--"}
                  </p>
                </div>
                <div className="p-3 bg-muted/30 rounded-lg">
                  <p className="text-sm text-muted-foreground">{t("datasets.info.features")}</p>
                  <p className="text-lg font-semibold">
                    {dataset.num_features?.toLocaleString(getActiveLocale()) ?? "--"}
                  </p>
                </div>
                <div className="p-3 bg-muted/30 rounded-lg">
                  <p className="text-sm text-muted-foreground">{t("datasets.card.task")}</p>
                  <p className="text-lg font-semibold">
                    {getDatasetTaskLabel(dataset.task_type, t, {
                      numClasses: dataset.num_classes,
                    })}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t("datasets.editModal.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
