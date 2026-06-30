import { useMemo, type ReactNode } from 'react';
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
import type { NodeDefinition, NodeType } from '@/data/nodes/types';
import { generateCustomNodeId } from '@/data/nodes/custom';
import type { CustomNodeValidationResult } from '@/data/nodes/custom';
import {
  getClassPathAllowlistStatus,
  type CustomNodeWizardDraft,
  type WizardStep,
} from './AddCustomNodeWizardLogic';
import { AddCustomNodeWizardParametersStep } from './AddCustomNodeWizardParametersStep';
import { AddCustomNodeWizardReviewStep } from './AddCustomNodeWizardReviewStep';

interface StepConfig {
  id: WizardStep;
  title: string;
  description: string;
  icon: ReactNode;
}

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

interface CustomNodeWizardHeaderProps {
  currentStep: WizardStep;
  currentStepIndex: number;
  onCancel: () => void;
  onStepChange: (step: WizardStep) => void;
}

export function CustomNodeWizardHeader({
  currentStep,
  currentStepIndex,
  onCancel,
  onStepChange,
}: CustomNodeWizardHeaderProps) {
  return (
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

      <div className="flex items-center gap-1">
        {WIZARD_STEPS.map((step, index) => (
          <div key={step.id} className="flex items-center">
            <button
              onClick={() => index <= currentStepIndex && onStepChange(step.id)}
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
  );
}

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
  const isValid = useMemo(
    () => getClassPathAllowlistStatus(classPath, allowedPackages),
    [classPath, allowedPackages]
  );

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

interface CustomNodeWizardContentProps {
  currentStep: WizardStep;
  draft: CustomNodeWizardDraft;
  node: NodeDefinition;
  validationResult?: CustomNodeValidationResult | null;
  allowedPackages: string[];
  onChangeDraft: (updates: Partial<CustomNodeWizardDraft>) => void;
}

export function CustomNodeWizardContent({
  currentStep,
  draft,
  node,
  validationResult,
  allowedPackages,
  onChangeDraft,
}: CustomNodeWizardContentProps) {
  return (
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
            <TypeStep
              value={draft.nodeType}
              onChange={(nodeType) => onChangeDraft({ nodeType })}
            />
          )}
          {currentStep === 'info' && (
            <InfoStep
              name={draft.name}
              description={draft.description}
              category={draft.category}
              onChangeName={(name) => onChangeDraft({ name })}
              onChangeDescription={(description) => onChangeDraft({ description })}
              onChangeCategory={(category) => onChangeDraft({ category })}
              nodeType={draft.nodeType}
            />
          )}
          {currentStep === 'classpath' && (
            <ClassPathStep
              classPath={draft.classPath}
              onChange={(classPath) => onChangeDraft({ classPath })}
              allowedPackages={allowedPackages}
            />
          )}
          {currentStep === 'parameters' && (
            <AddCustomNodeWizardParametersStep
              parameters={draft.parameters}
              onChange={(parameters) => onChangeDraft({ parameters })}
            />
          )}
          {currentStep === 'review' && (
            <AddCustomNodeWizardReviewStep
              node={node}
              validationResult={validationResult}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

interface CustomNodeWizardFooterProps {
  currentStep: WizardStep;
  currentStepIndex: number;
  canGoNext: boolean;
  onBack: () => void;
  onNext: () => void;
  onComplete: () => void;
}

export function CustomNodeWizardFooter({
  currentStep,
  currentStepIndex,
  canGoNext,
  onBack,
  onNext,
  onComplete,
}: CustomNodeWizardFooterProps) {
  return (
    <div className="px-4 py-3 border-t border-border flex items-center justify-between">
      <Button
        variant="outline"
        onClick={onBack}
        disabled={currentStepIndex === 0}
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back
      </Button>

      <div className="text-xs text-muted-foreground">
        Step {currentStepIndex + 1} of {WIZARD_STEPS.length}
      </div>

      {currentStep === 'review' ? (
        <Button onClick={onComplete} disabled={!canGoNext}>
          <Sparkles className="h-4 w-4 mr-1" />
          Create Node
        </Button>
      ) : (
        <Button onClick={onNext} disabled={!canGoNext}>
          Next
          <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      )}
    </div>
  );
}
