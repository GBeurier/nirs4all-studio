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
  return (
    <DialogFooter>
      <Button variant="outline" onClick={onCancel} disabled={isGenerating}>
        Cancel
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
            Generating...
          </>
        ) : (
          <>
            <Sparkles className="mr-2 h-4 w-4" />
            Generate Dataset
          </>
        )}
      </Button>
    </DialogFooter>
  );
}
