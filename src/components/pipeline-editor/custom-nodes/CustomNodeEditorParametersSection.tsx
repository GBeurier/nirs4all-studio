import { useCallback, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Plus,
  Trash2,
} from 'lucide-react';
import { AnimatePresence, motion } from '@/lib/motion';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import type { ParameterDefinition, ParameterType } from '@/data/nodes/types';
import {
  coerceEditorParameterDefault,
  formatEditorParameterOptions,
  parseEditorParameterOptionsInput,
} from './CustomNodeEditorLogic';

const PARAMETER_TYPES: { value: ParameterType; label: string; description: string }[] = [
  { value: 'int', label: 'Integer', description: 'Whole number' },
  { value: 'float', label: 'Float', description: 'Decimal number' },
  { value: 'bool', label: 'Boolean', description: 'True/False' },
  { value: 'string', label: 'String', description: 'Text value' },
  { value: 'select', label: 'Select', description: 'Dropdown options' },
];

interface CustomNodeParametersSectionProps {
  parameters: ParameterDefinition[];
  onAddParameter: () => void;
  onMoveParameter: (fromIndex: number, toIndex: number) => void;
  onRemoveParameter: (index: number) => void;
  onUpdateParameter: (index: number, updates: Partial<ParameterDefinition>) => void;
}

export function CustomNodeParametersSection({
  parameters,
  onAddParameter,
  onMoveParameter,
  onRemoveParameter,
  onUpdateParameter,
}: CustomNodeParametersSectionProps) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Parameters</h3>
          <p className="text-xs text-muted-foreground">
            Define the parameters for this operator
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onAddParameter}>
          <Plus className="h-4 w-4 mr-1" />
          Add Parameter
        </Button>
      </div>

      {parameters.length === 0 ? (
        <div className="text-center py-8 border rounded-lg border-dashed">
          <p className="text-sm text-muted-foreground">
            No parameters defined yet.
          </p>
          <Button variant="ghost" size="sm" onClick={onAddParameter} className="mt-2">
            <Plus className="h-4 w-4 mr-1" />
            Add your first parameter
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {parameters.map((param, index) => (
              <ParameterEditor
                key={`param-${index}`}
                param={param}
                index={index}
                onChange={onUpdateParameter}
                onRemove={onRemoveParameter}
                onMoveUp={index > 0 ? () => onMoveParameter(index, index - 1) : undefined}
                onMoveDown={index < parameters.length - 1 ? () => onMoveParameter(index, index + 1) : undefined}
                canMoveUp={index > 0}
                canMoveDown={index < parameters.length - 1}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}

interface ParameterEditorProps {
  param: ParameterDefinition;
  index: number;
  onChange: (index: number, updates: Partial<ParameterDefinition>) => void;
  onRemove: (index: number) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

function ParameterEditor({
  param,
  index,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: ParameterEditorProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const handleChange = useCallback(
    <K extends keyof ParameterDefinition>(field: K, value: ParameterDefinition[K]) => {
      onChange(index, { [field]: value });
    },
    [index, onChange]
  );

  const optionsString = useMemo(() => {
    return formatEditorParameterOptions(param.options);
  }, [param.options]);

  const handleOptionsChange = useCallback((value: string) => {
    handleChange('options', parseEditorParameterOptionsInput(value));
  }, [handleChange]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="border rounded-lg bg-muted/30"
    >
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <div className="flex items-center gap-2 p-2">
          <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />

          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>

          <Input
            value={param.name}
            onChange={(e) => handleChange('name', e.target.value)}
            placeholder="param_name"
            className="h-7 w-32 font-mono text-xs"
          />

          <Select
            value={param.type}
            onValueChange={(v) => handleChange('type', v as ParameterType)}
          >
            <SelectTrigger className="h-7 w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PARAMETER_TYPES.map(type => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex-1" />

          <div className="flex items-center gap-1">
            {canMoveUp && (
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onMoveUp}>
                ↑
              </Button>
            )}
            {canMoveDown && (
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onMoveDown}>
                ↓
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-destructive hover:text-destructive"
              onClick={() => onRemove(index)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <CollapsibleContent>
          <div className="px-3 pb-3 space-y-3">
            <Separator className="mb-3" />

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Default Value</Label>
                {param.type === 'bool' ? (
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={param.default === true}
                      onCheckedChange={(checked) => handleChange('default', checked)}
                    />
                    <span className="text-xs text-muted-foreground">
                      {param.default === true ? 'True' : 'False'}
                    </span>
                  </div>
                ) : param.type === 'select' ? (
                  <Select
                    value={String(param.default ?? '')}
                    onValueChange={(v) => handleChange('default', v)}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select default..." />
                    </SelectTrigger>
                    <SelectContent>
                      {param.options?.map((opt) => {
                        const value = typeof opt === 'object' ? opt.value : opt;
                        const label = typeof opt === 'object' ? opt.label : String(opt);
                        return (
                          <SelectItem key={String(value)} value={String(value)}>
                            {label}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    type={param.type === 'int' || param.type === 'float' ? 'number' : 'text'}
                    value={param.default !== undefined ? String(param.default) : ''}
                    onChange={(e) => {
                      handleChange('default', coerceEditorParameterDefault(e.target.value, param.type));
                    }}
                    className="h-8 text-xs font-mono"
                  />
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Description</Label>
                <Input
                  value={param.description ?? ''}
                  onChange={(e) => handleChange('description', e.target.value)}
                  placeholder="Parameter description..."
                  className="h-8 text-xs"
                />
              </div>
            </div>

            {(param.type === 'int' || param.type === 'float') && (
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Min</Label>
                  <Input
                    type="number"
                    value={param.min ?? ''}
                    onChange={(e) => handleChange('min', e.target.value ? Number(e.target.value) : undefined)}
                    className="h-8 text-xs font-mono"
                    placeholder="No limit"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Max</Label>
                  <Input
                    type="number"
                    value={param.max ?? ''}
                    onChange={(e) => handleChange('max', e.target.value ? Number(e.target.value) : undefined)}
                    className="h-8 text-xs font-mono"
                    placeholder="No limit"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Step</Label>
                  <Input
                    type="number"
                    value={param.step ?? ''}
                    onChange={(e) => handleChange('step', e.target.value ? Number(e.target.value) : undefined)}
                    className="h-8 text-xs font-mono"
                    placeholder="Auto"
                  />
                </div>
              </div>
            )}

            {param.type === 'select' && (
              <div className="space-y-1.5">
                <Label className="text-xs">Options (comma-separated)</Label>
                <Input
                  value={optionsString}
                  onChange={(e) => handleOptionsChange(e.target.value)}
                  placeholder="option1, option2, option3"
                  className="h-8 text-xs font-mono"
                />
              </div>
            )}

            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  checked={param.required ?? false}
                  onCheckedChange={(checked) => handleChange('required', checked)}
                  id={`param-${index}-required`}
                />
                <Label htmlFor={`param-${index}-required`} className="text-xs">
                  Required
                </Label>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={param.isAdvanced ?? false}
                  onCheckedChange={(checked) => handleChange('isAdvanced', checked)}
                  id={`param-${index}-advanced`}
                />
                <Label htmlFor={`param-${index}-advanced`} className="text-xs">
                  Advanced
                </Label>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={param.sweepable ?? false}
                  onCheckedChange={(checked) => handleChange('sweepable', checked)}
                  id={`param-${index}-sweepable`}
                />
                <Label htmlFor={`param-${index}-sweepable`} className="text-xs">
                  Sweepable
                </Label>
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </motion.div>
  );
}
