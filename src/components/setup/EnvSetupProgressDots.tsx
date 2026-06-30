import {
  VISUAL_STEPS,
  getVisualIndex,
  type WizardStep,
} from "./EnvSetup.helpers";

interface EnvSetupProgressDotsProps {
  currentStep: WizardStep;
}

export function EnvSetupProgressDots({ currentStep }: EnvSetupProgressDotsProps) {
  if (currentStep === "env") {
    return null;
  }

  const visualIndex = getVisualIndex(currentStep);

  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {VISUAL_STEPS.map((_, i) => (
        <div key={i} className="flex items-center">
          <div
            className={`w-2.5 h-2.5 rounded-full transition-colors ${
              i <= visualIndex ? "bg-primary" : "bg-muted-foreground/30"
            }`}
          />
          {i < VISUAL_STEPS.length - 1 && (
            <div
              className={`w-8 h-0.5 transition-colors ${
                i < visualIndex ? "bg-primary" : "bg-muted-foreground/30"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
