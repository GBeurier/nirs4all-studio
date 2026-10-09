import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookmarkPlus, Check, Palette } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  DEFAULT_INSPECTOR_SELECTION_COLOR,
  INSPECTOR_SELECTION_COLORS,
} from '@/lib/inspector/savedSelections';
import { cn } from '@/lib/utils';

interface InspectorSaveSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onSave: (name: string, color: string) => void;
}

export function InspectorSaveSelectionDialog({
  open,
  onOpenChange,
  selectedCount,
  onSave,
}: InspectorSaveSelectionDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_INSPECTOR_SELECTION_COLOR);

  const handleSave = useCallback(() => {
    if (!name.trim()) {
      toast.error(t('inspector.saved.nameRequired'));
      return;
    }
    onSave(name.trim(), color);
    setName('');
    setColor(DEFAULT_INSPECTOR_SELECTION_COLOR);
    onOpenChange(false);
  }, [name, color, onSave, onOpenChange, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookmarkPlus className="w-5 h-5" />
            {t('inspector.saved.dialogTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('inspector.saved.dialogDescription', { count: selectedCount })}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <label htmlFor="inspector-selection-name" className="text-sm font-medium">
              {t('inspector.saved.name')}
            </label>
            <Input
              id="inspector-selection-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && name.trim() && handleSave()}
              placeholder={t('inspector.saved.namePlaceholder')}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5" />
              {t('inspector.saved.color')}
            </label>
            <InspectorSelectionColorPicker value={color} onChange={setColor} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={!name.trim()}>
            <Check className="w-4 h-4 mr-1.5" />
            {t('inspector.saved.dialogTitle')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InspectorSelectionColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap gap-1">
      {INSPECTOR_SELECTION_COLORS.map((color) => (
        <button
          key={color.value}
          type="button"
          className={cn(
            'w-5 h-5 rounded-full border-2 transition-all',
            value === color.value
              ? 'border-foreground scale-110'
              : 'border-transparent hover:border-muted-foreground/50',
          )}
          style={{ backgroundColor: color.value }}
          onClick={() => onChange(color.value)}
          title={t(color.nameKey)}
          aria-label={t(color.nameKey)}
          aria-pressed={value === color.value}
        />
      ))}
    </div>
  );
}
