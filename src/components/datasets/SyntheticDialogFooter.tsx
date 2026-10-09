import { useTranslation } from "react-i18next";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import {
  isGenerateDisabled,
  type SyntheticDialogTab,
} from "./SyntheticDataDialogData";

interface SyntheticDialogFooterProps {
  activeTab: SyntheticDialogTab;
  isGenerating: boolean;
  onCancel: () => void;
  onGenerate: () => void;
  selectedPreset: string | null;
  name?: string;
}

export function SyntheticDialogFooter({
  activeTab,
  isGenerating,
  onCancel,
  onGenerate,
  selectedPreset,
  name,
}: SyntheticDialogFooterProps) {
  const { t } = useTranslation();
  return (
    <DialogFooter>
      <Button variant="outline" onClick={onCancel} disabled={isGenerating}>
        {t("common.cancel")}
      </Button>
      <Button
        onClick={onGenerate}
        disabled={isGenerateDisabled({
          isGenerating,
          activeTab,
          selectedPreset,
          name,
        })}
      >
        {isGenerating ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t("datasets.synthetic.generating")}
          </>
        ) : (
          <>
            <Sparkles className="mr-2 h-4 w-4" />
            {t("datasets.synthetic.generate")}
          </>
        )}
      </Button>
    </DialogFooter>
  );
}
