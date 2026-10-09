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
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-card border-border shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-5 h-5" />
            {t('playground.operators.card.errorTitle', { name: displayName })}
          </DialogTitle>
          <DialogDescription>
            {t('playground.operators.card.errorDescription')}
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
            {t('playground.operators.card.copyError')}
          </Button>
          <Button
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
