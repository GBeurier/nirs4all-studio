/**
 * MetadataView - Display generated metadata
 *
 * Shows metadata columns from synthetic data generation:
 * - Sample IDs
 * - Group assignments
 * - Batch IDs
 * - Partition labels (train/test)
 */

import { useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PreviewData, PreviewStatistics } from "../contexts";
import { cn } from "@/lib/utils";

interface MetadataViewProps {
  data: PreviewData;
  className?: string;
}

interface MetadataSummary {
  name: string;
  type: "id" | "group" | "batch" | "partition" | "unknown";
  uniqueCount: number;
  sampleValues: string[];
}

export function MetadataView({ data, className }: MetadataViewProps) {
  const metadata = useMemo(() => {
    // Extract metadata from statistics if available
    const stats = data.statistics as PreviewStatistics & {
      metadata?: Record<string, unknown[]>;
      batch_distribution?: Record<string, number>;
      group_distribution?: Record<string, number>;
    };

    const summaries: MetadataSummary[] = [];

    // Check for batch distribution
    if (stats?.batch_distribution) {
      const batches = Object.keys(stats.batch_distribution);
      summaries.push({
        name: "Batch ID",
        type: "batch",
        uniqueCount: batches.length,
        sampleValues: batches.slice(0, 5),
      });
    }

    // Check for group distribution
    if (stats?.group_distribution) {
      const groups = Object.keys(stats.group_distribution);
      summaries.push({
        name: "Group",
        type: "group",
        uniqueCount: groups.length,
        sampleValues: groups.slice(0, 5),
      });
    }

    // Check for class distribution (already shown in histogram, but include for reference)
    if (stats?.class_distribution && data.target_type === "classification") {
      const classes = Object.keys(stats.class_distribution);
      summaries.push({
        name: "Class",
        type: "partition",
        uniqueCount: classes.length,
        sampleValues: classes.map((c) => `Class ${c}`),
      });
    }

    // Sample count info
    summaries.push({
      name: "Samples",
      type: "id",
      uniqueCount: data.actual_samples,
      sampleValues: [
        `Preview: ${data.spectra.length}`,
        `Total: ${data.actual_samples}`,
      ],
    });

    return summaries;
  }, [data]);

  if (metadata.length === 0) {
    return (
      <div className={cn("flex items-center justify-center h-full", className)}>
        <p className="text-sm text-muted-foreground">No metadata available</p>
      </div>
    );
  }

  // If only one or two items, show as simple list
  if (metadata.length <= 2) {
    return (
      <div className={cn("p-2 space-y-3", className)}>
        <div className="text-xs font-medium text-muted-foreground">
          Dataset Info
        </div>
        {metadata.map((meta) => (
          <MetadataCard key={meta.name} metadata={meta} />
        ))}
      </div>
    );
  }

  // Multiple metadata types - use tabs
  return (
    <div className={cn("h-full flex flex-col", className)}>
      <Tabs defaultValue={metadata[0].name} className="flex-1 flex flex-col">
        <TabsList className="h-7 w-full justify-start bg-transparent border-b rounded-none px-2">
          {metadata.map((meta) => (
            <TabsTrigger
              key={meta.name}
              value={meta.name}
              className="h-6 text-xs px-2 data-[state=active]:bg-muted"
            >
              {meta.name}
            </TabsTrigger>
          ))}
        </TabsList>
        {metadata.map((meta) => (
          <TabsContent
            key={meta.name}
            value={meta.name}
            className="flex-1 mt-0 p-2"
          >
            <MetadataCard metadata={meta} expanded />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

interface MetadataCardProps {
  metadata: MetadataSummary;
  expanded?: boolean;
}

function MetadataCard({ metadata, expanded }: MetadataCardProps) {
  const typeColors = {
    id: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    group: "bg-green-500/10 text-green-600 dark:text-green-400",
    batch: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
    partition: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
    unknown: "bg-gray-500/10 text-gray-600 dark:text-gray-400",
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{metadata.name}</span>
        <Badge variant="secondary" className="h-5 text-[10px]">
          {metadata.uniqueCount} unique
        </Badge>
      </div>
      {expanded && (
        <ScrollArea className="h-20">
          <div className="flex flex-wrap gap-1">
            {metadata.sampleValues.map((val, idx) => (
              <Badge
                key={idx}
                variant="outline"
                className={cn("text-[10px] h-5", typeColors[metadata.type])}
              >
                {val}
              </Badge>
            ))}
            {metadata.uniqueCount > metadata.sampleValues.length && (
              <span className="text-[10px] text-muted-foreground">
                +{metadata.uniqueCount - metadata.sampleValues.length} more
              </span>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
