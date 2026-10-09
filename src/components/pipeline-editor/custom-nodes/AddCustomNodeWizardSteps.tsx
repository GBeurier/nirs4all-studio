import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
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
  titleKey: string;
  descriptionKey: string;
  icon: ReactNode;
}

const WIZARD_STEPS: StepConfig[] = [
  {
    id: 'type',
    titleKey: 'pipelineEditor.customNodes.wizard.steps.type.title',
    descriptionKey: 'pipelineEditor.customNodes.wizard.steps.type.description',
    icon: <Package className="h-4 w-4" />,
  },
  {
    id: 'info',
    titleKey: 'pipelineEditor.customNodes.wizard.steps.info.title',
    descriptionKey: 'pipelineEditor.customNodes.wizard.steps.info.description',
    icon: <FileText className="h-4 w-4" />,
  },
  {
    id: 'classpath',
    titleKey: 'pipelineEditor.customNodes.wizard.steps.classpath.title',
    descriptionKey: 'pipelineEditor.customNodes.wizard.steps.classpath.description',
    icon: <Settings className="h-4 w-4" />,
  },
  {
    id: 'parameters',
    titleKey: 'pipelineEditor.customNodes.wizard.steps.parameters.title',
    descriptionKey: 'pipelineEditor.customNodes.wizard.steps.parameters.description',
    icon: <ListChecks className="h-4 w-4" />,
  },
  {
    id: 'review',
    titleKey: 'pipelineEditor.customNodes.wizard.steps.review.title',
    descriptionKey: 'pipelineEditor.customNodes.wizard.steps.review.description',
    icon: <Check className="h-4 w-4" />,
  },
];

const NODE_TYPE_OPTIONS: { value: NodeType; icon: string }[] = [
  { value: 'preprocessing', icon: '🔧' },
  { value: 'splitting', icon: '✂️' },
  { value: 'model', icon: '🎯' },
  { value: 'y_processing', icon: '📊' },
  { value: 'filter', icon: '🔍' },
  { value: 'augmentation', icon: '✨' },
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
  const { t } = useTranslation();
  return (
    <div className="px-4 py-3 border-b border-border">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Wand2 className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">{t('pipelineEditor.customNodes.wizard.title')}</h2>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>

      <div className="flex items-center gap-1">
        {WIZARD_STEPS.map((step, index) => (
          <div key={step.id} className="flex items-center">
            <button
              onClick={() => index <= currentStepIndex && onStepChange(step.id)}
              disabled={index > currentStepIndex}
              aria-label={t(step.titleKey)}
              aria-current={currentStep === step.id ? 'step' : undefined}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                currentStep === step.id
                  ? "bg-primary text-primary-foreground"
                  : index < currentStepIndex
                    ? "bg-muted text-foreground hover:bg-muted/80"
                    : "text-muted-foreground"
              )}
            >
              {step.icon}
              <span className="hidden sm:inline">{t(step.titleKey)}</span>
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
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium">{t('pipelineEditor.customNodes.wizard.type.heading')}</h3>
        <p className="text-sm text-muted-foreground">
          {t('pipelineEditor.customNodes.wizard.type.hint')}
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
                <span className="font-medium">{t(`pipelineEditor.customNodes.types.${option.value}.label`)}</span>
              </div>
              <p className="text-xs text-muted-foreground">{t(`pipelineEditor.customNodes.types.${option.value}.description`)}</p>
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
  const { t } = useTranslation();
  const previewId = generateCustomNodeId(name);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">{t('pipelineEditor.customNodes.wizard.info.heading')}</h3>
        <p className="text-sm text-muted-foreground">
          {t('pipelineEditor.customNodes.wizard.info.hint')}
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="wizard-name">{t('pipelineEditor.customNodes.wizard.info.name')}</Label>
          <Input
            id="wizard-name"
            value={name}
            onChange={(e) => onChangeName(e.target.value)}
            placeholder="MyCustomOperator"
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            {t('pipelineEditor.customNodes.wizard.info.nodeId')} <code className="bg-muted px-1 py-0.5 rounded">{previewId}</code>
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="wizard-description">{t('pipelineEditor.customNodes.wizard.info.description')}</Label>
          <Textarea
            id="wizard-description"
            value={description}
            onChange={(e) => onChangeDescription(e.target.value)}
            placeholder={t('pipelineEditor.customNodes.wizard.info.descriptionPlaceholder')}
            rows={3}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="wizard-category">{t('pipelineEditor.customNodes.wizard.info.category')}</Label>
          <Input
            id="wizard-category"
            value={category}
            onChange={(e) => onChangeCategory(e.target.value)}
            placeholder="Custom"
          />
          <p className="text-xs text-muted-foreground">
            {t('pipelineEditor.customNodes.wizard.info.categoryHint', { type: t(`pipelineEditor.customNodes.types.${nodeType}.label`) })}
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
  const { t } = useTranslation();
  const isValid = useMemo(
    () => getClassPathAllowlistStatus(classPath, allowedPackages),
    [classPath, allowedPackages]
  );

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">{t('pipelineEditor.customNodes.wizard.classPath.heading')}</h3>
        <p className="text-sm text-muted-foreground">
          {t('pipelineEditor.customNodes.wizard.classPath.hint')}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="wizard-classpath">
          {t('pipelineEditor.customNodes.wizard.classPath.label')}
          {isValid === true && (
            <Badge variant="outline" className="ml-2 text-green-500 border-green-500">
              {t('pipelineEditor.customNodes.wizard.classPath.valid')}
            </Badge>
          )}
          {isValid === false && (
            <Badge variant="outline" className="ml-2 text-destructive border-destructive">
              {t('pipelineEditor.customNodes.wizard.classPath.notAllowed')}
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
        <h4 className="text-sm font-medium">{t('pipelineEditor.customNodes.wizard.classPath.allowedPackages')}</h4>
        <div className="flex flex-wrap gap-2">
          {allowedPackages.map(pkg => (
            <Badge key={pkg} variant="secondary" className="font-mono text-xs">
              {pkg}.*
            </Badge>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {t('pipelineEditor.customNodes.wizard.classPath.security')}
        </p>
      </div>

      {!classPath.trim() && (
        <div className="flex items-start gap-2 text-sm text-muted-foreground">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <p>
            {t('pipelineEditor.customNodes.wizard.classPath.skip')}
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
  const { t } = useTranslation();
  return (
    <div className="px-4 py-3 border-t border-border flex items-center justify-between">
      <Button
        variant="outline"
        onClick={onBack}
        disabled={currentStepIndex === 0}
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        {t('common.back')}
      </Button>

      <div className="text-xs text-muted-foreground">
        {t('pipelineEditor.customNodes.wizard.stepOf', { current: currentStepIndex + 1, total: WIZARD_STEPS.length })}
      </div>

      {currentStep === 'review' ? (
        <Button onClick={onComplete} disabled={!canGoNext}>
          <Sparkles className="h-4 w-4 mr-1" />
          {t('pipelineEditor.customNodes.wizard.create')}
        </Button>
      ) : (
        <Button onClick={onNext} disabled={!canGoNext}>
          {t('common.next')}
          <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      )}
    </div>
  );
}
