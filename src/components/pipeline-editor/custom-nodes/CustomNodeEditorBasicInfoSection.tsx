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

const NODE_TYPES: { value: NodeType; label: string }[] = [
  { value: 'preprocessing', label: 'Preprocessing' },
  { value: 'y_processing', label: 'Target Processing' },
  { value: 'splitting', label: 'Splitting' },
  { value: 'model', label: 'Model' },
  { value: 'filter', label: 'Filter' },
  { value: 'augmentation', label: 'Augmentation' },
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
  return (
    <section className="space-y-4">
      <h3 className="text-sm font-medium">Basic Information</h3>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="node-name">Name *</Label>
          <Input
            id="node-name"
            value={name}
            onChange={(e) => onChangeName(e.target.value)}
            placeholder="MyCustomOperator"
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            ID: <code className="bg-muted px-1 py-0.5 rounded">{previewId}</code>
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="node-type">Type *</Label>
          <Select value={type} onValueChange={(v) => onChangeType(v as NodeType)}>
            <SelectTrigger id="node-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NODE_TYPES.map(t => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="node-description">Description *</Label>
        <Textarea
          id="node-description"
          value={description}
          onChange={(e) => onChangeDescription(e.target.value)}
          placeholder="Describe what this operator does..."
          rows={2}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="node-classpath">
          Class Path
          {classPathValid === true && (
            <Badge variant="outline" className="ml-2 text-green-500 border-green-500">
              Valid
            </Badge>
          )}
          {classPathValid === false && (
            <Badge variant="outline" className="ml-2 text-destructive border-destructive">
              Not in allowlist
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
          Allowed packages: {allowedPackages.join(', ')}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="node-category">Category</Label>
          <Input
            id="node-category"
            value={category}
            onChange={(e) => onChangeCategory(e.target.value)}
            placeholder="Custom"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="node-tags">Tags (comma-separated)</Label>
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
            Advanced (hide in basic mode)
          </Label>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            checked={isDeepLearning}
            onCheckedChange={onChangeIsDeepLearning}
            id="node-dl"
          />
          <Label htmlFor="node-dl" className="text-sm">
            Deep Learning (show training config)
          </Label>
        </div>
      </div>
    </section>
  );
}
