import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { NodeType } from '@/data/nodes/types';

const NODE_TYPES: NodeType[] = [
  'preprocessing',
  'y_processing',
  'splitting',
  'model',
  'filter',
  'augmentation',
];

interface CustomNodeBasicInfoSectionProps {
  allowedPackages: string[];
  category: string;
  classPath: string;
  classPathValid: boolean | null;
  description: string;
  isAdvanced: boolean;
  isDeepLearning: boolean;
  name: string;
  previewId: string;
  tags: string;
  type: NodeType;
  onChangeCategory: (value: string) => void;
  onChangeClassPath: (value: string) => void;
  onChangeDescription: (value: string) => void;
  onChangeIsAdvanced: (value: boolean) => void;
  onChangeIsDeepLearning: (value: boolean) => void;
  onChangeName: (value: string) => void;
  onChangeTags: (value: string) => void;
  onChangeType: (value: NodeType) => void;
}

export function CustomNodeBasicInfoSection({
  allowedPackages,
  category,
  classPath,
  classPathValid,
  description,
  isAdvanced,
  isDeepLearning,
  name,
  previewId,
  tags,
  type,
  onChangeCategory,
  onChangeClassPath,
  onChangeDescription,
  onChangeIsAdvanced,
  onChangeIsDeepLearning,
  onChangeName,
  onChangeTags,
  onChangeType,
}: CustomNodeBasicInfoSectionProps) {
  const { t } = useTranslation();
  return (
    <section className="space-y-4">
      <h3 className="text-sm font-medium">{t('pipelineEditor.customNodes.editor.basic.heading')}</h3>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="node-name">{t('pipelineEditor.customNodes.editor.basic.name')}</Label>
          <Input
            id="node-name"
            value={name}
            onChange={(e) => onChangeName(e.target.value)}
            placeholder="MyCustomOperator"
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            {t('pipelineEditor.customNodes.editor.basic.id')} <code className="bg-muted px-1 py-0.5 rounded">{previewId}</code>
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="node-type">{t('pipelineEditor.customNodes.editor.basic.type')}</Label>
          <Select value={type} onValueChange={(v) => onChangeType(v as NodeType)}>
            <SelectTrigger id="node-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NODE_TYPES.map((nodeType) => (
                <SelectItem key={nodeType} value={nodeType}>
                  {t(`pipelineEditor.customNodes.types.${nodeType}.label`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="node-description">{t('pipelineEditor.customNodes.editor.basic.description')}</Label>
        <Textarea
          id="node-description"
          value={description}
          onChange={(e) => onChangeDescription(e.target.value)}
          placeholder={t('pipelineEditor.customNodes.editor.basic.descriptionPlaceholder')}
          rows={2}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="node-classpath">
          {t('pipelineEditor.customNodes.editor.basic.classPath')}
          {classPathValid === true && (
            <Badge variant="outline" className="ml-2 text-green-500 border-green-500">
              {t('pipelineEditor.customNodes.editor.basic.valid')}
            </Badge>
          )}
          {classPathValid === false && (
            <Badge variant="outline" className="ml-2 text-destructive border-destructive">
              {t('pipelineEditor.customNodes.editor.basic.notAllowed')}
            </Badge>
          )}
        </Label>
        <Input
          id="node-classpath"
          value={classPath}
          onChange={(e) => onChangeClassPath(e.target.value)}
          placeholder="nirs4all.operators.transforms.MyOperator"
          className={cn(
            "font-mono",
            classPathValid === false && "border-destructive"
          )}
        />
        <p className="text-xs text-muted-foreground">
          {t('pipelineEditor.customNodes.editor.basic.allowedPackages', { packages: allowedPackages.join(', ') })}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="node-category">{t('pipelineEditor.customNodes.editor.basic.category')}</Label>
          <Input
            id="node-category"
            value={category}
            onChange={(e) => onChangeCategory(e.target.value)}
            placeholder="Custom"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="node-tags">{t('pipelineEditor.customNodes.editor.basic.tags')}</Label>
          <Input
            id="node-tags"
            value={tags}
            onChange={(e) => onChangeTags(e.target.value)}
            placeholder="preprocessing, custom"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-6">
        <div className="flex items-center gap-2">
          <Switch
            checked={isAdvanced}
            onCheckedChange={onChangeIsAdvanced}
            id="node-advanced"
          />
          <Label htmlFor="node-advanced" className="text-sm">
            {t('pipelineEditor.customNodes.editor.basic.advanced')}
          </Label>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            checked={isDeepLearning}
            onCheckedChange={onChangeIsDeepLearning}
            id="node-dl"
          />
          <Label htmlFor="node-dl" className="text-sm">
            {t('pipelineEditor.customNodes.editor.basic.deepLearning')}
          </Label>
        </div>
      </div>
    </section>
  );
}
