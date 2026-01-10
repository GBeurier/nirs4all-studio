/**
 * CustomNodeEditor - Editor for creating and editing custom node definitions
 *
 * Provides a full editing interface for custom nodes including:
 * - Basic node info (name, type, description)
 * - Class path with validation
 * - Parameter builder with type-specific options
 * - Live validation feedback
 *
 * @see docs/_internals/node_specifications.md Section 6
 * @see docs/_internals/implementation_roadmap.md Task 5.3
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  GripVertical,
  Copy,
  Wand2,
  Check,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from '@/lib/motion';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { NodeDefinition, NodeType, ParameterDefinition, ParameterType } from '@/data/nodes/types';
import {
  generateCustomNodeId,
  createParameterTemplate,
  DEFAULT_ALLOWED_PACKAGES,
} from '@/data/nodes/custom';
import type { CustomNodeValidationResult } from '@/data/nodes/custom';

// ============================================================================
// Types
// ============================================================================

export interface CustomNodeEditorProps {
  /** Initial node definition (for editing existing node) */
  initialNode?: NodeDefinition;
  /** Callback when node is saved */
  onSave: (node: NodeDefinition) => void;
  /** Callback when editing is cancelled */
  onCancel: () => void;
  /** External validation function */
  validateNode?: (node: NodeDefinition) => CustomNodeValidationResult;
  /** Allowed packages for classPath */
  allowedPackages?: string[];
  /** Whether the editor is in edit mode (vs create mode) */
  isEditMode?: boolean;
  /** Additional class name */
  className?: string;
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

// ============================================================================
// Constants
// ============================================================================

const NODE_TYPES: { value: NodeType; label: string }[] = [
  { value: 'preprocessing', label: 'Preprocessing' },
  { value: 'y_processing', label: 'Target Processing' },
  { value: 'splitting', label: 'Splitting' },
  { value: 'model', label: 'Model' },
  { value: 'filter', label: 'Filter' },
  { value: 'augmentation', label: 'Augmentation' },
];

const PARAMETER_TYPES: { value: ParameterType; label: string; description: string }[] = [
  { value: 'int', label: 'Integer', description: 'Whole number' },
  { value: 'float', label: 'Float', description: 'Decimal number' },
  { value: 'bool', label: 'Boolean', description: 'True/False' },
  { value: 'string', label: 'String', description: 'Text value' },
  { value: 'select', label: 'Select', description: 'Dropdown options' },
];

// ============================================================================
// ParameterEditor Component
// ============================================================================

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

  // Handle options as comma-separated string for select type
  const optionsString = useMemo(() => {
    if (!param.options) return '';
    return param.options.map(opt =>
      typeof opt === 'object' ? opt.value : opt
    ).join(', ');
  }, [param.options]);

  const handleOptionsChange = useCallback((value: string) => {
    const values = value.split(',').map(v => v.trim()).filter(Boolean);
    const options = values.map(v => ({
      value: v,
      label: v,
    }));
    handleChange('options', options);
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

            {/* Default value */}
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
                      const val = e.target.value;
                      if (param.type === 'int') {
                        handleChange('default', parseInt(val) || 0);
                      } else if (param.type === 'float') {
                        handleChange('default', parseFloat(val) || 0);
                      } else {
                        handleChange('default', val);
                      }
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

            {/* Numeric constraints */}
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

            {/* Select options */}
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

            {/* Flags */}
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

// ============================================================================
// CustomNodeEditor Component
// ============================================================================

export function CustomNodeEditor({
  initialNode,
  onSave,
  onCancel,
  validateNode,
  allowedPackages = DEFAULT_ALLOWED_PACKAGES,
  isEditMode = false,
  className,
}: CustomNodeEditorProps) {
  // Form state
  const [name, setName] = useState(initialNode?.name ?? '');
  const [type, setType] = useState<NodeType>(initialNode?.type ?? 'preprocessing');
  const [classPath, setClassPath] = useState(initialNode?.classPath ?? '');
  const [description, setDescription] = useState(initialNode?.description ?? '');
  const [category, setCategory] = useState(initialNode?.category ?? 'Custom');
  const [tags, setTags] = useState(initialNode?.tags?.join(', ') ?? '');
  const [parameters, setParameters] = useState<ParameterDefinition[]>(
    initialNode?.parameters ?? []
  );
  const [isAdvanced, setIsAdvanced] = useState(initialNode?.isAdvanced ?? false);
  const [isDeepLearning, setIsDeepLearning] = useState(initialNode?.isDeepLearning ?? false);

  // Validation state
  const [validationResult, setValidationResult] = useState<CustomNodeValidationResult | null>(null);
  const [classPathValid, setClassPathValid] = useState<boolean | null>(null);

  // Build node definition from form state
  const buildNodeDefinition = useCallback((): NodeDefinition => {
    const nodeId = isEditMode && initialNode?.id
      ? initialNode.id
      : generateCustomNodeId(name);

    return {
      id: nodeId,
      name: name.trim(),
      type,
      classPath: classPath.trim() || undefined,
      description: description.trim(),
      category: category.trim() || 'Custom',
      tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      parameters,
      isAdvanced,
      isDeepLearning,
      source: 'custom',
    };
  }, [name, type, classPath, description, category, tags, parameters, isAdvanced, isDeepLearning, isEditMode, initialNode?.id]);

  // Validate on changes
  useEffect(() => {
    if (validateNode) {
      const node = buildNodeDefinition();
      const result = validateNode(node);
      setValidationResult(result);
    }
  }, [buildNodeDefinition, validateNode]);

  // Validate classPath separately for immediate feedback
  useEffect(() => {
    if (!classPath.trim()) {
      setClassPathValid(null);
      return;
    }

    const packageRoot = classPath.split('.')[0];
    const isAllowed = allowedPackages.some(pkg =>
      classPath.startsWith(pkg + '.') || classPath === pkg
    );
    setClassPathValid(isAllowed);
  }, [classPath, allowedPackages]);

  // Parameter handlers
  const handleAddParameter = useCallback(() => {
    setParameters(prev => [...prev, createParameterTemplate()]);
  }, []);

  const handleUpdateParameter = useCallback((index: number, updates: Partial<ParameterDefinition>) => {
    setParameters(prev => prev.map((p, i) => i === index ? { ...p, ...updates } : p));
  }, []);

  const handleRemoveParameter = useCallback((index: number) => {
    setParameters(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleMoveParameter = useCallback((fromIndex: number, toIndex: number) => {
    setParameters(prev => {
      const newParams = [...prev];
      const [moved] = newParams.splice(fromIndex, 1);
      newParams.splice(toIndex, 0, moved);
      return newParams;
    });
  }, []);

  // Save handler
  const handleSave = useCallback(() => {
    const node = buildNodeDefinition();

    if (validateNode) {
      const result = validateNode(node);
      if (!result.valid) {
        setValidationResult(result);
        return;
      }
    }

    onSave(node);
  }, [buildNodeDefinition, validateNode, onSave]);

  // Generate ID preview
  const previewId = useMemo(() => {
    if (isEditMode && initialNode?.id) return initialNode.id;
    return generateCustomNodeId(name);
  }, [name, isEditMode, initialNode?.id]);

  const hasErrors = validationResult && !validationResult.valid;
  const hasWarnings = validationResult && validationResult.warnings.length > 0;

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-foreground">
              {isEditMode ? 'Edit Custom Node' : 'Create Custom Node'}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isEditMode
                ? `Editing: ${initialNode?.name}`
                : 'Define a new operator for your pipelines'
              }
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onCancel}>
              <X className="h-4 w-4 mr-1" />
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={hasErrors || !name.trim()}
            >
              <Check className="h-4 w-4 mr-1" />
              {isEditMode ? 'Save Changes' : 'Create Node'}
            </Button>
          </div>
        </div>
      </div>

      {/* Validation Errors Banner */}
      {hasErrors && validationResult && (
        <div className="px-4 py-2 bg-destructive/10 border-b border-destructive/20">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
            <div className="space-y-0.5">
              {validationResult.errors.map((error, i) => (
                <p key={i} className="text-xs text-destructive">{error}</p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Validation Warnings Banner */}
      {hasWarnings && validationResult && !hasErrors && (
        <div className="px-4 py-2 bg-orange-500/10 border-b border-orange-500/20">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-orange-500 mt-0.5 flex-shrink-0" />
            <div className="space-y-0.5">
              {validationResult.warnings.map((warning, i) => (
                <p key={i} className="text-xs text-orange-500">{warning}</p>
              ))}
            </div>
          </div>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* Basic Info Section */}
          <section className="space-y-4">
            <h3 className="text-sm font-medium">Basic Information</h3>

            <div className="grid grid-cols-2 gap-4">
              {/* Name */}
              <div className="space-y-1.5">
                <Label htmlFor="node-name">Name *</Label>
                <Input
                  id="node-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="MyCustomOperator"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  ID: <code className="bg-muted px-1 py-0.5 rounded">{previewId}</code>
                </p>
              </div>

              {/* Type */}
              <div className="space-y-1.5">
                <Label htmlFor="node-type">Type *</Label>
                <Select value={type} onValueChange={(v) => setType(v as NodeType)}>
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

            {/* Description */}
            <div className="space-y-1.5">
              <Label htmlFor="node-description">Description *</Label>
              <Textarea
                id="node-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what this operator does..."
                rows={2}
              />
            </div>

            {/* Class Path */}
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
                onChange={(e) => setClassPath(e.target.value)}
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
              {/* Category */}
              <div className="space-y-1.5">
                <Label htmlFor="node-category">Category</Label>
                <Input
                  id="node-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="Custom"
                />
              </div>

              {/* Tags */}
              <div className="space-y-1.5">
                <Label htmlFor="node-tags">Tags (comma-separated)</Label>
                <Input
                  id="node-tags"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="preprocessing, custom"
                />
              </div>
            </div>

            {/* Flags */}
            <div className="flex flex-wrap gap-6">
              <div className="flex items-center gap-2">
                <Switch
                  checked={isAdvanced}
                  onCheckedChange={setIsAdvanced}
                  id="node-advanced"
                />
                <Label htmlFor="node-advanced" className="text-sm">
                  Advanced (hide in basic mode)
                </Label>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={isDeepLearning}
                  onCheckedChange={setIsDeepLearning}
                  id="node-dl"
                />
                <Label htmlFor="node-dl" className="text-sm">
                  Deep Learning (show training config)
                </Label>
              </div>
            </div>
          </section>

          <Separator />

          {/* Parameters Section */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium">Parameters</h3>
                <p className="text-xs text-muted-foreground">
                  Define the parameters for this operator
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={handleAddParameter}>
                <Plus className="h-4 w-4 mr-1" />
                Add Parameter
              </Button>
            </div>

            {parameters.length === 0 ? (
              <div className="text-center py-8 border rounded-lg border-dashed">
                <p className="text-sm text-muted-foreground">
                  No parameters defined yet.
                </p>
                <Button variant="ghost" size="sm" onClick={handleAddParameter} className="mt-2">
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
                      onChange={handleUpdateParameter}
                      onRemove={handleRemoveParameter}
                      onMoveUp={index > 0 ? () => handleMoveParameter(index, index - 1) : undefined}
                      onMoveDown={index < parameters.length - 1 ? () => handleMoveParameter(index, index + 1) : undefined}
                      canMoveUp={index > 0}
                      canMoveDown={index < parameters.length - 1}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}
