import {
  DeletePipelineDialog,
  ExportPipelineDialog,
  ImportPipelineModal,
} from "@/components/pipelines";
import type { Pipeline } from "@/types/pipelines";

interface PipelinesModalsProps {
  deleteDialogOpen: boolean;
  exportDialogOpen: boolean;
  exportJson: string | null;
  importModalOpen: boolean;
  onConfirmDelete: () => Promise<void>;
  onDeleteDialogOpenChange: (open: boolean) => void;
  onExportDialogOpenChange: (open: boolean) => void;
  onImport: (jsonString: string) => Promise<Pipeline | null>;
  onImportModalOpenChange: (open: boolean) => void;
  selectedPipeline: Pipeline | null;
}

export function PipelinesModals({
  deleteDialogOpen,
  exportDialogOpen,
  exportJson,
  importModalOpen,
  onConfirmDelete,
  onDeleteDialogOpenChange,
  onExportDialogOpenChange,
  onImport,
  onImportModalOpenChange,
  selectedPipeline,
}: PipelinesModalsProps) {
  return (
    <>
      <ImportPipelineModal
        open={importModalOpen}
        onOpenChange={onImportModalOpenChange}
        onImport={onImport}
      />

      <DeletePipelineDialog
        open={deleteDialogOpen}
        onOpenChange={onDeleteDialogOpenChange}
        pipeline={selectedPipeline}
        onConfirm={onConfirmDelete}
      />

      <ExportPipelineDialog
        open={exportDialogOpen}
        onOpenChange={onExportDialogOpenChange}
        pipeline={selectedPipeline}
        jsonContent={exportJson}
      />
    </>
  );
}
