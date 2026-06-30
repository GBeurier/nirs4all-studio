import { ArrowLeft } from "lucide-react";

import { motion } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MissingNodesConfirmDialog } from "@/components/pipeline-editor/MissingNodesConfirmDialog";
import {
  NEW_EXPERIMENT_MAX_STEP,
  shouldShowNewExperimentWizardActions,
} from "@/lib/experimentWizardFlow";

import {
  NewExperimentStepContent,
  type NewExperimentStepContentProps,
} from "./NewExperimentStepContent";
import { NewExperimentStepProgress } from "./NewExperimentStepProgress";
import { NewExperimentWizardActions } from "./NewExperimentWizardActions";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export interface NewExperimentShellProps extends NewExperimentStepContentProps {
  canProceed: boolean;
  onBack: () => void;
  onNext: () => void;
  onExit: () => void;
}

export function NewExperimentShell({
  canProceed,
  onBack,
  onNext,
  onExit,
  ...stepContentProps
}: NewExperimentShellProps) {
  const { currentStep, launchFlow } = stepContentProps;

  return (
    <motion.div
      className="space-y-6"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={itemVariants} className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={onExit}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New Experiment</h1>
          <p className="text-muted-foreground">Create and launch pipeline experiments</p>
        </div>
      </motion.div>

      <motion.div variants={itemVariants}>
        <NewExperimentStepProgress currentStep={currentStep} />
      </motion.div>

      <motion.div variants={itemVariants}>
        <Card className="mx-auto max-w-4xl">
          <CardContent className="p-6">
            <NewExperimentStepContent {...stepContentProps} />
          </CardContent>
        </Card>
      </motion.div>

      {shouldShowNewExperimentWizardActions(currentStep) && (
        <motion.div variants={itemVariants}>
          <NewExperimentWizardActions
            canProceed={canProceed}
            currentStep={currentStep}
            maxStep={NEW_EXPERIMENT_MAX_STEP}
            onBack={onBack}
            onNext={onNext}
          />
        </motion.div>
      )}

      <MissingNodesConfirmDialog
        open={launchFlow.showMissingNodesDialog}
        onOpenChange={launchFlow.handleMissingNodesDialogOpenChange}
        issues={launchFlow.pendingMissingIssues}
        onConfirm={launchFlow.handleConfirmPrunedLaunch}
        title="Launch experiment without missing nodes?"
        description="Unavailable operators will be removed from temporary copies of the affected pipelines before the experiment starts. Saved pipelines stay unchanged."
        confirmLabel="Launch Experiment"
      />
    </motion.div>
  );
}
