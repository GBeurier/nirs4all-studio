import { Archive, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ChainDetailArtifactSummary as ChainDetailArtifactSummaryData } from "./useChainDetailPanelState";

interface ChainDetailArtifactSummaryProps {
  summary: ChainDetailArtifactSummaryData;
}

export function ChainDetailArtifactSummary({ summary }: ChainDetailArtifactSummaryProps) {
  if (summary.totalCount === 0) return null;

  return (
    <details className="group rounded-xl border border-border/70 bg-card/40 open:bg-card/70">
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center justify-between gap-2",
          "rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/40",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Archive className="h-3.5 w-3.5" />
          </span>
          <span className="truncate text-sm font-semibold tracking-tight">Artifacts and provenance</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline" className="text-[10px]">
            {summary.totalCountLabel}
          </Badge>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </div>
      </summary>

      <div className="space-y-3 border-t border-border/60 px-3 py-3 text-sm">
        <div className="flex flex-wrap gap-1.5">
          {[...summary.kindItems, ...summary.statusItems].map(item => (
            <Badge key={item.id} variant="secondary" className="text-[10px]">
              {item.label}: {item.artifactCountLabel}
            </Badge>
          ))}
        </div>

        <div className="grid gap-2 xl:grid-cols-2">
          {summary.provenanceGroups.map(group => (
            <div key={group.id} className="rounded-lg border border-border/60 bg-background/65 px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-foreground">{group.label}</p>
                  <p className="mt-1 break-words text-[11px] text-muted-foreground">
                    {group.artifactLabels.join(", ")}
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  {group.artifactCountLabel}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
