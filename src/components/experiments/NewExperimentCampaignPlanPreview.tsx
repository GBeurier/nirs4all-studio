import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp } from "lucide-react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { CampaignPlanPreview } from "@/lib/campaignPlanPreviewTypes";
import type { NewExperimentExecutionEnvironmentDiagnostics } from "@/lib/experimentExecutionEnvironment";
import { getCampaignPlanPreviewTitle } from "@/lib/campaignPlanPresentation";

import { NewExperimentCampaignPreviewSections } from "./NewExperimentCampaignPreviewSections";

export interface NewExperimentCampaignPlanPreviewProps {
  campaignPreview: CampaignPlanPreview;
  executionEnvironmentDiagnostics?: NewExperimentExecutionEnvironmentDiagnostics;
}

export function NewExperimentCampaignPlanPreview({
  campaignPreview,
  executionEnvironmentDiagnostics,
}: NewExperimentCampaignPlanPreviewProps) {
  const { t } = useTranslation();
  const [isExpanded, setExpanded] = useState(false);

  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={setExpanded}
      className="rounded-lg border border-border/60 bg-muted/20"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 p-4 text-left"
          aria-label={isExpanded ? t("newExperiment.campaign.preview.collapse") : t("newExperiment.campaign.preview.expand")}
        >
          <h3 className="text-sm font-medium text-foreground">{getCampaignPlanPreviewTitle()}</h3>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-4 pb-4">
        <NewExperimentCampaignPreviewSections
          campaignPreview={campaignPreview}
          executionEnvironmentDiagnostics={executionEnvironmentDiagnostics}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}
