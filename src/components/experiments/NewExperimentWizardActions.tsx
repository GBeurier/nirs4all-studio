import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";

export interface NewExperimentWizardActionsProps {
  canProceed: boolean;
  currentStep: number;
  maxStep: number;
  onBack: () => void;
  onNext: () => void;
}

export function NewExperimentWizardActions({
  canProceed,
  currentStep,
  maxStep,
  onBack,
  onNext,
}: NewExperimentWizardActionsProps) {
  const { t } = useTranslation();

  return (
    <div className="mx-auto flex max-w-4xl justify-between">
      <Button variant="outline" onClick={onBack} disabled={currentStep === 1}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        {t("common.back")}
      </Button>
      <Button onClick={onNext} disabled={!canProceed || currentStep >= maxStep}>
        {t("common.next")}
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );
}
