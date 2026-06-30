import { Children, type ReactNode } from "react";

import { formatHiddenCampaignPreviewCount } from "@/lib/campaignPlanPresentation";

export const campaignPreviewCardClass = "rounded-md border border-border/50 bg-background/70 px-3 py-2 text-sm";
export const campaignPreviewTagClass = "rounded border border-border/60 bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground";

export interface NewExperimentCampaignPreviewSectionProps {
  title: string;
  children: ReactNode;
  hiddenCount?: number;
  hiddenLabel?: string;
}

export function NewExperimentCampaignPreviewSection({
  title,
  children,
  hiddenCount,
  hiddenLabel,
}: NewExperimentCampaignPreviewSectionProps) {
  const hiddenText = hiddenLabel
    ? formatHiddenCampaignPreviewCount(hiddenCount ?? 0, hiddenLabel)
    : null;
  const hasChildren = Children.count(children) > 0;

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h4>
      {hasChildren && (
        <div className="space-y-2">{children}</div>
      )}
      {hiddenText && (
        <p className="text-xs text-muted-foreground">{hiddenText}</p>
      )}
    </div>
  );
}
