import { useCallback, useState } from 'react';
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
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_INSPECTOR_SELECTION_COLOR);

  const handleSave = useCallback(() => {
    if (!name.trim()) {
      toast.error('Please enter a name for the selection');
      return;
    }
    onSave(name.trim(), color);
    setName('');
    setColor(DEFAULT_INSPECTOR_SELECTION_COLOR);
    onOpenChange(false);
  }, [name, color, onSave, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookmarkPlus className="w-5 h-5" />
            Save Selection
          </DialogTitle>
          <DialogDescription>
            Save the current {selectedCount} selected chain{selectedCount !== 1 ? 's' : ''} for
            later use.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <label htmlFor="inspector-selection-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="inspector-selection-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && name.trim() && handleSave()}
              placeholder="e.g., Best PLS models, Branch A chains..."
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5" />
              Color
            </label>
            <InspectorSelectionColorPicker value={color} onChange={setColor} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!name.trim()}>
            <Check className="w-4 h-4 mr-1.5" />
            Save Selection
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
          title={color.name}
        />
      ))}
    </div>
  );
}
