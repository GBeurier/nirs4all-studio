import { Archive, Fingerprint } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ResultArtifactSummaryData } from "./resultDetailData";

interface ResultMetricsArtifactSummaryProps {
  summary: ResultArtifactSummaryData;
}

export function ResultMetricsArtifactSummary({ summary }: ResultMetricsArtifactSummaryProps) {
  if (summary.groups.length === 0) return null;

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="flex items-center gap-2 text-sm font-medium">
          <Archive className="h-4 w-4 text-muted-foreground" />
          Artifacts
        </h4>
        <Badge variant="outline" className="text-xs">
          {summary.totalCountLabel}
        </Badge>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {[...summary.kindItems, ...summary.statusItems].map(item => (
          <Badge key={item.id} variant="secondary" className="text-[10px]">
            {item.label}: {item.artifactCountLabel}
          </Badge>
        ))}
      </div>

      {summary.repositoryItems.length > 0 && (
        <div className="mb-3 space-y-2 border-b pb-3">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <Fingerprint className="h-3.5 w-3.5" />
            Repository provenance
          </div>
          <div className="space-y-1.5">
            {summary.repositoryItems.map(item => (
              <div key={item.id} className="min-w-0">
                <p className="truncate text-xs font-medium text-foreground">{item.label}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {item.detailLabels.map(label => (
                    <Badge key={`${item.id}-${label}`} variant="outline" className="max-w-full break-all text-[10px]">
                      {label}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {summary.groups.map(group => (
          <div key={group.id} className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-foreground">{group.label}</p>
                <p className="break-words text-[11px] text-muted-foreground">
                  {group.artifactLabels.join(", ")}
                </p>
              </div>
              <Badge variant="secondary" className="shrink-0 text-[10px]">
                {group.artifactCountLabel}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
