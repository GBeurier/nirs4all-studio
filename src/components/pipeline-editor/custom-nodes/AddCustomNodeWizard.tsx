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
import { cn } from '@/lib/utils';
import type { NodeDefinition } from '@/data/nodes/types';
import {
  DEFAULT_ALLOWED_PACKAGES,
} from '@/data/nodes/custom';
import { CustomNodeEditor } from './CustomNodeEditor';
import type { CustomNodeValidationResult } from '@/data/nodes/custom';
import {
  buildCustomNodeFromWizardDraft,
  canAdvanceFromWizardStep,
  createInitialCustomNodeWizardDraft,
  getNextWizardStep,
  getPreviousWizardStep,
  getWizardStepIndex,
  type CustomNodeWizardDraft,
  type WizardStep,
} from './AddCustomNodeWizardLogic';
import {
  CustomNodeWizardContent,
  CustomNodeWizardFooter,
  CustomNodeWizardHeader,
} from './AddCustomNodeWizardSteps';

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
  const [draft, setDraft] = useState(createInitialCustomNodeWizardDraft);

  // Build current node definition
  const node = useMemo<NodeDefinition>(
    () => buildCustomNodeFromWizardDraft(draft),
    [draft]
  );

  // Validation
  const validationResult = useMemo(() => {
    if (!validateNode) return null;
    return validateNode(node);
  }, [validateNode, node]);

  // Step navigation
  const currentStepIndex = getWizardStepIndex(currentStep);

  const canGoNext = useMemo(
    () => canAdvanceFromWizardStep(currentStep, draft, validationResult),
    [currentStep, draft, validationResult]
  );

  const updateDraft = useCallback((updates: Partial<CustomNodeWizardDraft>) => {
    setDraft((currentDraft) => ({ ...currentDraft, ...updates }));
  }, []);

  const goNext = () => {
    const nextStep = getNextWizardStep(currentStep);
    if (nextStep) {
      setCurrentStep(nextStep);
    }
  };

  const goPrev = () => {
    const previousStep = getPreviousWizardStep(currentStep);
    if (previousStep) {
      setCurrentStep(previousStep);
    }
  };

  const handleComplete = () => {
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
      <CustomNodeWizardHeader
        currentStep={currentStep}
        currentStepIndex={currentStepIndex}
        onCancel={onCancel}
        onStepChange={setCurrentStep}
      />
      <CustomNodeWizardContent
        currentStep={currentStep}
        draft={draft}
        node={node}
        validationResult={validationResult}
        allowedPackages={allowedPackages}
        onChangeDraft={updateDraft}
      />
      <CustomNodeWizardFooter
        currentStep={currentStep}
        currentStepIndex={currentStepIndex}
        canGoNext={canGoNext}
        onBack={goPrev}
        onNext={goNext}
        onComplete={handleComplete}
      />
    </div>
  );
}
