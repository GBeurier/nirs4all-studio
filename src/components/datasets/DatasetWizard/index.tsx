/**
 * DatasetWizard - Main container component for the multi-step dataset loading wizard
 *
 * Steps:
 * 1. Source Selection - Choose folder, files, URL, or synthetic
 * 2. File Detection & Mapping - Map files to roles (X, Y, metadata)
 * 3. Parsing Configuration - CSV options, signal type, NA policy
 * 4. Target Configuration - Select targets, task type, aggregation
 * 5. Preview & Confirm - View data preview and confirm
 */
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { WizardProvider } from "./WizardContext";
import { WizardContent } from "./WizardContent";
import type { WizardInitialState } from "./useWizard";
import type { DatasetConfig } from "@/types/datasets";

interface DatasetWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (path: string, config?: Partial<DatasetConfig>) => Promise<void>;
  /** Initial state from drag-and-drop */
  initialState?: WizardInitialState;
  /** Callback to open batch scan dialog from wizard source step */
  onScanFolder?: (path: string) => void;
  submitLabel?: string;
  submitErrorMessage?: string;
}

export function DatasetWizard({ open, onOpenChange, onAdd, initialState, onScanFolder, submitLabel, submitErrorMessage }: DatasetWizardProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <WizardProvider initialState={initialState}>
          <WizardContent
            onAdd={onAdd}
            onClose={() => onOpenChange(false)}
            onScanFolder={onScanFolder}
            submitLabel={submitLabel}
            submitErrorMessage={submitErrorMessage}
          />
        </WizardProvider>
      </DialogContent>
    </Dialog>
  );
}

// Re-export types for convenience
export type { WizardInitialState } from "./useWizard";
