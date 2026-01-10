/**
 * AddCustomNodeWizard - Step-by-step wizard for adding custom nodes
 *
 * Provides a guided experience for creating custom nodes:
 * 1. Choose node type
 * 2. Enter basic info (name, description)
 * 3. Configure class path
 * 4. Add parameters
 * 5. Review and save
 *
 * @see docs/_internals/implementation_roadmap.md Task 5.4
 */

import { useState, useCallback, useMemo } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Wand2,
  Package,
  FileText,
  Settings,
  ListChecks,
  Sparkles,
  AlertCircle,
} from 'lucide-react';
import { motion, AnimatePresence } from '@/lib/motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import type { NodeDefinition, NodeType, ParameterDefinition } from '@/data/nodes/types';
import {
  generateCustomNodeId,
  createParameterTemplate,
  DEFAULT_ALLOWED_PACKAGES,
} from '@/data/nodes/custom';
import { CustomNodeEditor } from './CustomNodeEditor';
import type { CustomNodeValidationResult } from '@/data/nodes/custom';

// ============================================================================
// Types
// ============================================================================

export interface AddCustomNodeWizardProps {
  /** Callback when node is successfully created */
  onComplete: (node: NodeDefinition) => void;
  /** Callback when wizard is cancelled */
  onCancel: () => void;
  /** Validation function from useCustomNodes */
  validateNode?: (node: NodeDefinition) => CustomNodeValidationResult;
  /** Allowed packages for classPath */
  allowedPackages?: string[];
  /** Whether to use simplified wizard or full editor */
  mode?: 'wizard' | 'editor';
  /** Additional class name */
  className?: string;
}

type WizardStep = 'type' | 'info' | 'classpath' | 'parameters' | 'review';

interface StepConfig {
  id: WizardStep;
  title: string;
  description: string;
  icon: React.ReactNode;
}

// ============================================================================
// Constants
// ============================================================================

const WIZARD_STEPS: StepConfig[] = [
  {
    id: 'type',
    title: 'Node Type',
    description: 'Choose the category',
    icon: <Package className="h-4 w-4" />,
  },
  {
    id: 'info',
    title: 'Basic Info',
    description: 'Name and description',
    icon: <FileText className="h-4 w-4" />,
  },
  {
    id: 'classpath',
    title: 'Class Path',
    description: 'Python operator path',
    icon: <Settings className="h-4 w-4" />,
  },
  {
    id: 'parameters',
    title: 'Parameters',
    description: 'Configure inputs',
    icon: <ListChecks className="h-4 w-4" />,
  },
  {
    id: 'review',
    title: 'Review',
    description: 'Confirm and save',
    icon: <Check className="h-4 w-4" />,
  },
];

const NODE_TYPE_OPTIONS: { value: NodeType; label: string; description: string; icon: string }[] = [
  {
    value: 'preprocessing',
    label: 'Preprocessing',
    description: 'Transform and prepare spectral data',
    icon: '🔧',
  },
  {
    value: 'splitting',
    label: 'Splitting',
    description: 'Cross-validation and train/test splitting',
    icon: '✂️',
  },
  {
    value: 'model',
    label: 'Model',
    description: 'Regression or classification models',
    icon: '🎯',
  },
  {
    value: 'y_processing',
    label: 'Target Processing',
    description: 'Transform the target variable',
    icon: '📊',
  },
  {
    value: 'filter',
    label: 'Filter',
    description: 'Sample filtering and outlier removal',
    icon: '🔍',
  },
  {
    value: 'augmentation',
    label: 'Augmentation',
    description: 'Data augmentation operators',
    icon: '✨',
  },
];

// ============================================================================
// Step Components
// ============================================================================

interface TypeStepProps {
  value: NodeType;
  onChange: (type: NodeType) => void;
}

function TypeStep({ value, onChange }: TypeStepProps) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium">What type of operator is this?</h3>
        <p className="text-sm text-muted-foreground">
          This determines where it appears in the pipeline palette.
        </p>
      </div>

      <RadioGroup
        value={value}
        onValueChange={(v) => onChange(v as NodeType)}
        className="grid grid-cols-2 gap-3"
      >
        {NODE_TYPE_OPTIONS.map((option) => (
          <Label
            key={option.value}
            htmlFor={`type-${option.value}`}
            className={cn(
              "flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors",
              "hover:bg-muted/50",
              value === option.value && "border-primary bg-primary/5"
            )}
          >
            <RadioGroupItem
              value={option.value}
              id={`type-${option.value}`}
              className="mt-0.5"
            />
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-lg">{option.icon}</span>
                <span className="font-medium">{option.label}</span>
              </div>
              <p className="text-xs text-muted-foreground">{option.description}</p>
            </div>
          </Label>
        ))}
      </RadioGroup>
    </div>
  );
}

interface InfoStepProps {
  name: string;
  description: string;
  category: string;
  onChangeName: (name: string) => void;
  onChangeDescription: (desc: string) => void;
  onChangeCategory: (cat: string) => void;
  nodeType: NodeType;
}

function InfoStep({
  name,
  description,
  category,
  onChangeName,
  onChangeDescription,
  onChangeCategory,
  nodeType,
}: InfoStepProps) {
  const previewId = generateCustomNodeId(name);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Basic Information</h3>
        <p className="text-sm text-muted-foreground">
          Give your operator a name and description.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="wizard-name">Operator Name *</Label>
          <Input
            id="wizard-name"
            value={name}
            onChange={(e) => onChangeName(e.target.value)}
            placeholder="MyCustomOperator"
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Node ID: <code className="bg-muted px-1 py-0.5 rounded">{previewId}</code>
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="wizard-description">Description *</Label>
          <Textarea
            id="wizard-description"
            value={description}
            onChange={(e) => onChangeDescription(e.target.value)}
            placeholder="Describe what this operator does..."
            rows={3}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="wizard-category">Category</Label>
          <Input
            id="wizard-category"
            value={category}
            onChange={(e) => onChangeCategory(e.target.value)}
            placeholder="Custom"
          />
          <p className="text-xs text-muted-foreground">
            Subcategory within the {NODE_TYPE_OPTIONS.find(t => t.value === nodeType)?.label || nodeType} section.
          </p>
        </div>
      </div>
    </div>
  );
}

interface ClassPathStepProps {
  classPath: string;
  onChange: (path: string) => void;
  allowedPackages: string[];
}

function ClassPathStep({ classPath, onChange, allowedPackages }: ClassPathStepProps) {
  const isValid = useMemo(() => {
    if (!classPath.trim()) return null;
    return allowedPackages.some(pkg =>
      classPath.startsWith(pkg + '.') || classPath === pkg
    );
  }, [classPath, allowedPackages]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Python Class Path</h3>
        <p className="text-sm text-muted-foreground">
          The full import path to your Python operator class.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="wizard-classpath">
          Class Path
          {isValid === true && (
            <Badge variant="outline" className="ml-2 text-green-500 border-green-500">
              ✓ Valid
            </Badge>
          )}
          {isValid === false && (
            <Badge variant="outline" className="ml-2 text-destructive border-destructive">
              Not in allowlist
            </Badge>
          )}
        </Label>
        <Input
          id="wizard-classpath"
          value={classPath}
          onChange={(e) => onChange(e.target.value)}
          placeholder="nirs4all.operators.transforms.MyOperator"
          className={cn(
            "font-mono",
            isValid === false && "border-destructive focus-visible:ring-destructive"
          )}
        />
      </div>

      <div className="p-4 rounded-lg bg-muted/50 space-y-2">
        <h4 className="text-sm font-medium">Allowed Packages</h4>
        <div className="flex flex-wrap gap-2">
          {allowedPackages.map(pkg => (
            <Badge key={pkg} variant="secondary" className="font-mono text-xs">
              {pkg}.*
            </Badge>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          For security, only operators from these packages can be used.
        </p>
      </div>

      {!classPath.trim() && (
        <div className="flex items-start gap-2 text-sm text-muted-foreground">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <p>
            You can skip this step if you're just prototyping. However, the node
            won't be executable until a valid class path is provided.
          </p>
        </div>
      )}
    </div>
  );
}

interface ParametersStepProps {
  parameters: ParameterDefinition[];
  onChange: (params: ParameterDefinition[]) => void;
}

function ParametersStep({ parameters, onChange }: ParametersStepProps) {
  const addParameter = () => {
    onChange([...parameters, createParameterTemplate()]);
  };

  const removeParameter = (index: number) => {
    onChange(parameters.filter((_, i) => i !== index));
  };

  const updateParameter = (index: number, updates: Partial<ParameterDefinition>) => {
    onChange(parameters.map((p, i) => i === index ? { ...p, ...updates } : p));
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Parameters</h3>
        <p className="text-sm text-muted-foreground">
          Define the parameters your operator accepts. You can add more later.
        </p>
      </div>

      <div className="space-y-3">
        {parameters.map((param, index) => (
          <div
            key={index}
            className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30"
          >
            <div className="flex-1 grid grid-cols-3 gap-2">
              <Input
                value={param.name}
                onChange={(e) => updateParameter(index, { name: e.target.value })}
                placeholder="param_name"
                className="font-mono text-sm h-8"
              />
              <select
                value={param.type}
                onChange={(e) => updateParameter(index, { type: e.target.value as ParameterDefinition['type'] })}
                className="h-8 px-2 text-sm rounded border bg-background"
              >
                <option value="int">Integer</option>
                <option value="float">Float</option>
                <option value="bool">Boolean</option>
                <option value="string">String</option>
                <option value="select">Select</option>
              </select>
              <Input
                type={param.type === 'int' || param.type === 'float' ? 'number' : 'text'}
                value={param.default !== undefined ? String(param.default) : ''}
                onChange={(e) => {
                  let value: unknown = e.target.value;
                  if (param.type === 'int') value = parseInt(e.target.value) || 0;
                  if (param.type === 'float') value = parseFloat(e.target.value) || 0;
                  if (param.type === 'bool') value = e.target.value === 'true';
                  updateParameter(index, { default: value });
                }}
                placeholder="Default"
                className="font-mono text-sm h-8"
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-destructive hover:text-destructive"
              onClick={() => removeParameter(index)}
            >
              ×
            </Button>
          </div>
        ))}

        <Button variant="outline" size="sm" onClick={addParameter} className="w-full">
          + Add Parameter
        </Button>
      </div>

      {parameters.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          No parameters defined. Click "Add Parameter" to add one, or skip this step
          if your operator doesn't need any.
        </p>
      )}
    </div>
  );
}

interface ReviewStepProps {
  node: NodeDefinition;
  validationResult?: CustomNodeValidationResult | null;
}

function ReviewStep({ node, validationResult }: ReviewStepProps) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Review Your Custom Node</h3>
        <p className="text-sm text-muted-foreground">
          Confirm the details before creating your custom operator.
        </p>
      </div>

      {validationResult && !validationResult.valid && (
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 space-y-2">
          <div className="flex items-center gap-2 text-destructive font-medium">
            <AlertCircle className="h-4 w-4" />
            Validation Errors
          </div>
          <ul className="text-sm text-destructive list-disc list-inside">
            {validationResult.errors.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {validationResult?.warnings && validationResult.warnings.length > 0 && (
        <div className="p-4 rounded-lg bg-orange-500/10 border border-orange-500/20 space-y-2">
          <div className="flex items-center gap-2 text-orange-500 font-medium">
            <AlertCircle className="h-4 w-4" />
            Warnings
          </div>
          <ul className="text-sm text-orange-600 list-disc list-inside">
            {validationResult.warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-4 p-4 rounded-lg border bg-muted/30">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-xs text-muted-foreground">Name</span>
            <p className="font-medium">{node.name}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Type</span>
            <p className="font-medium capitalize">{node.type}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">ID</span>
            <p className="font-mono text-sm">{node.id}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Category</span>
            <p className="font-medium">{node.category || 'Custom'}</p>
          </div>
        </div>

        <div>
          <span className="text-xs text-muted-foreground">Description</span>
          <p className="text-sm">{node.description || '—'}</p>
        </div>

        <div>
          <span className="text-xs text-muted-foreground">Class Path</span>
          <p className="font-mono text-sm">{node.classPath || '(not specified)'}</p>
        </div>

        <div>
          <span className="text-xs text-muted-foreground">Parameters ({node.parameters.length})</span>
          {node.parameters.length > 0 ? (
            <div className="flex flex-wrap gap-1 mt-1">
              {node.parameters.map((param) => (
                <Badge key={param.name} variant="secondary" className="font-mono text-xs">
                  {param.name}: {param.type}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No parameters</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Wizard Component
// ============================================================================

export function AddCustomNodeWizard({
  onComplete,
  onCancel,
  validateNode,
  allowedPackages = DEFAULT_ALLOWED_PACKAGES,
  mode = 'wizard',
  className,
}: AddCustomNodeWizardProps) {
  // Wizard state
  const [currentStep, setCurrentStep] = useState<WizardStep>('type');
  const [nodeType, setNodeType] = useState<NodeType>('preprocessing');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Custom');
  const [classPath, setClassPath] = useState('');
  const [parameters, setParameters] = useState<ParameterDefinition[]>([]);

  // Build current node definition
  const buildNode = useCallback((): NodeDefinition => ({
    id: generateCustomNodeId(name),
    name: name.trim(),
    type: nodeType,
    classPath: classPath.trim() || undefined,
    description: description.trim(),
    category: category.trim() || 'Custom',
    parameters,
    source: 'custom',
  }), [name, nodeType, classPath, description, category, parameters]);

  // Validation
  const validationResult = useMemo(() => {
    if (!validateNode) return null;
    return validateNode(buildNode());
  }, [validateNode, buildNode]);

  // Step navigation
  const currentStepIndex = WIZARD_STEPS.findIndex(s => s.id === currentStep);

  const canGoNext = useMemo(() => {
    switch (currentStep) {
      case 'type':
        return true;
      case 'info':
        return name.trim().length > 0 && description.trim().length > 0;
      case 'classpath':
        return true; // Optional
      case 'parameters':
        return true; // Optional
      case 'review':
        return !validationResult || validationResult.valid;
      default:
        return true;
    }
  }, [currentStep, name, description, validationResult]);

  const goNext = () => {
    if (currentStepIndex < WIZARD_STEPS.length - 1) {
      setCurrentStep(WIZARD_STEPS[currentStepIndex + 1].id);
    }
  };

  const goPrev = () => {
    if (currentStepIndex > 0) {
      setCurrentStep(WIZARD_STEPS[currentStepIndex - 1].id);
    }
  };

  const handleComplete = () => {
    const node = buildNode();
    if (validateNode) {
      const result = validateNode(node);
      if (!result.valid) return;
    }
    onComplete(node);
  };

  // If mode is 'editor', show full editor instead of wizard
  if (mode === 'editor') {
    return (
      <CustomNodeEditor
        onSave={onComplete}
        onCancel={onCancel}
        validateNode={validateNode}
        allowedPackages={allowedPackages}
        className={className}
      />
    );
  }

  // Wizard UI
  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header with steps */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Add Custom Node</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-1">
          {WIZARD_STEPS.map((step, index) => (
            <div key={step.id} className="flex items-center">
              <button
                onClick={() => index <= currentStepIndex && setCurrentStep(step.id)}
                disabled={index > currentStepIndex}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors",
                  currentStep === step.id
                    ? "bg-primary text-primary-foreground"
                    : index < currentStepIndex
                      ? "bg-muted text-foreground hover:bg-muted/80"
                      : "text-muted-foreground"
                )}
              >
                {step.icon}
                <span className="hidden sm:inline">{step.title}</span>
              </button>
              {index < WIZARD_STEPS.length - 1 && (
                <div className={cn(
                  "w-4 h-px mx-1",
                  index < currentStepIndex ? "bg-primary" : "bg-border"
                )} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto p-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            {currentStep === 'type' && (
              <TypeStep value={nodeType} onChange={setNodeType} />
            )}
            {currentStep === 'info' && (
              <InfoStep
                name={name}
                description={description}
                category={category}
                onChangeName={setName}
                onChangeDescription={setDescription}
                onChangeCategory={setCategory}
                nodeType={nodeType}
              />
            )}
            {currentStep === 'classpath' && (
              <ClassPathStep
                classPath={classPath}
                onChange={setClassPath}
                allowedPackages={allowedPackages}
              />
            )}
            {currentStep === 'parameters' && (
              <ParametersStep
                parameters={parameters}
                onChange={setParameters}
              />
            )}
            {currentStep === 'review' && (
              <ReviewStep
                node={buildNode()}
                validationResult={validationResult}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer with navigation */}
      <div className="px-4 py-3 border-t border-border flex items-center justify-between">
        <Button
          variant="outline"
          onClick={goPrev}
          disabled={currentStepIndex === 0}
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>

        <div className="text-xs text-muted-foreground">
          Step {currentStepIndex + 1} of {WIZARD_STEPS.length}
        </div>

        {currentStep === 'review' ? (
          <Button onClick={handleComplete} disabled={!canGoNext}>
            <Sparkles className="h-4 w-4 mr-1" />
            Create Node
          </Button>
        ) : (
          <Button onClick={goNext} disabled={!canGoNext}>
            Next
            <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </div>
    </div>
  );
}
