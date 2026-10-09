import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WizardState } from "@/types/datasets";

interface FileMappingStepHeaderProps {
  sourceType: WizardState["sourceType"];
  basePath: string;
  datasetName: string;
  onDatasetNameChange: (value: string) => void;
}

export function FileMappingStepHeader({
  sourceType,
  basePath,
  datasetName,
  onDatasetNameChange,
}: FileMappingStepHeaderProps) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <Label className="text-sm text-muted-foreground">
          {sourceType === "folder" ? t("datasets.wizard.fileMapping.folderPath") : t("datasets.wizard.fileMapping.basePath")}
        </Label>
        <div className="flex items-center gap-2">
          <Label className="text-sm text-muted-foreground">{t("datasets.wizard.fileMapping.datasetName")}</Label>
          <Input
            value={datasetName}
            onChange={(event) => onDatasetNameChange(event.target.value)}
            className="h-7 w-48 text-sm"
            placeholder={t("datasets.wizard.fileMapping.datasetNamePlaceholder")}
          />
        </div>
      </div>
      <div className="px-3 py-2 bg-muted/50 rounded-md text-sm font-mono truncate">
        {basePath}
      </div>
    </div>
  );
}
