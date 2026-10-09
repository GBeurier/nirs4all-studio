import { Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { NodeDefinition } from '@/data/nodes/types';

interface CustomNodeEditorHeaderProps {
  initialNode?: NodeDefinition;
  isEditMode: boolean;
  hasErrors: boolean | null;
  name: string;
  onCancel: () => void;
  onSave: () => void;
}

export function CustomNodeEditorHeader({
  initialNode,
  isEditMode,
  hasErrors,
  name,
  onCancel,
  onSave,
}: CustomNodeEditorHeaderProps) {
  const { t } = useTranslation();
  return (
    <div className="px-4 py-3 border-b border-border">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-foreground">
            {isEditMode ? t('pipelineEditor.customNodes.editor.editTitle') : t('pipelineEditor.customNodes.editor.createTitle')}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isEditMode
              ? t('pipelineEditor.customNodes.editor.editing', { name: initialNode?.name })
              : t('pipelineEditor.customNodes.editor.createHint')
            }
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            <X className="h-4 w-4 mr-1" />
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            onClick={onSave}
            disabled={hasErrors || !name.trim()}
          >
            <Check className="h-4 w-4 mr-1" />
            {isEditMode ? t('pipelineEditor.customNodes.editor.saveChanges') : t('pipelineEditor.customNodes.wizard.create')}
          </Button>
        </div>
      </div>
    </div>
  );
}
