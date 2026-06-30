import { AlertTriangle, Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface UnifiedOperatorCardErrorDialogProps {
  open: boolean;
  displayName: string;
  errorMessage?: string;
  onOpenChange: (open: boolean) => void;
  onCopyError: () => void;
}

export function UnifiedOperatorCardErrorDialog({
  open,
  displayName,
  errorMessage,
  onOpenChange,
  onCopyError,
}: UnifiedOperatorCardErrorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-card border-border shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-5 h-5" />
            {displayName} failed
          </DialogTitle>
          <DialogDescription>
            The operator threw an error during pipeline execution. Copy the log
            below when filing an issue.
          </DialogDescription>
        </DialogHeader>
        <pre className="max-h-[50vh] overflow-auto rounded border border-destructive/30 bg-destructive/5 p-3 text-[11px] leading-relaxed font-mono text-destructive whitespace-pre-wrap break-words">
          {errorMessage}
        </pre>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={onCopyError}
            className="gap-2"
          >
            <Copy className="w-3.5 h-3.5" />
            Copy error
          </Button>
          <Button
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
