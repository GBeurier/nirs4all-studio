import type { ReactNode } from "react";
import { Play } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { CampaignPlanPreview } from "@/lib/campaignPlanPreviewTypes";
import {
  buildExperimentLaunchBadgeLabels,
  getExperimentLaunchDescription,
} from "@/lib/experimentLaunchPresentation";

export interface NewExperimentLaunchHeroProps {
  campaignPreview: CampaignPlanPreview;
  children?: ReactNode;
  experimentDescription: string;
  experimentName: string;
}

export function NewExperimentLaunchHero({
  campaignPreview,
  children,
  experimentDescription,
  experimentName,
}: NewExperimentLaunchHeroProps) {
  const description = getExperimentLaunchDescription(experimentDescription);
  const badgeLabels = buildExperimentLaunchBadgeLabels(campaignPreview);

  return (
    <>
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
        <Play className="h-8 w-8 text-primary" />
      </div>
      <div>
        <h2 className="text-xl font-semibold text-foreground">{experimentName}</h2>
        {description && (
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
        )}
        <p className="mt-2 text-muted-foreground">{campaignPreview.summary.launchSummary}</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {badgeLabels.map((badge) => (
            <Badge key={badge.id} variant="outline">{badge.label}</Badge>
          ))}
        </div>
        {children}
      </div>
    </>
  );
}
