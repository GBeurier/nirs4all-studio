/**
 * WorkspaceDiscoveryPanel Component
 * Shows discovered runs, predictions, exports from a linked workspace.
 * Phase 7 Implementation
 */

import { useState, useEffect } from "react";
import {
  Play,
  FileBox,
  Database,
  FileCode,
  Loader2,
  AlertCircle,
  ChevronRight,
  FileJson,
  FileArchive,
  FileSpreadsheet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  getN4AWorkspaceRuns,
  getN4AWorkspaceExports,
  getN4AWorkspacePredictions,
  getN4AWorkspaceTemplates,
} from "@/api/client";
import { formatRelativeTime, formatBytes } from "@/utils/formatters";
import type {
  DiscoveredRun,
  DiscoveredExport,
  DiscoveredPrediction,
  DiscoveredTemplate,
} from "@/types/linked-workspaces";

interface DiscoverySectionProps {
  title: string;
  icon: React.ReactNode;
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function DiscoverySection({
  title,
  icon,
  count,
  children,
  defaultOpen = false,
}: DiscoverySectionProps) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 hover:bg-muted/50 rounded transition-colors">
        <ChevronRight className="h-4 w-4 transition-transform [[data-state=open]>&]:rotate-90" />
        {icon}
        <span className="font-medium text-sm">{title}</span>
        <Badge variant="secondary" className="ml-auto text-xs">{count}</Badge>
      </CollapsibleTrigger>
      <CollapsibleContent className="pl-8 pr-2 pb-2">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

function getExportIcon(type: string) {
  switch (type) {
    case "n4a_bundle":
      return <FileArchive className="h-3 w-3" />;
    case "pipeline_json":
      return <FileJson className="h-3 w-3" />;
    case "predictions_csv":
      return <FileSpreadsheet className="h-3 w-3" />;
    default:
      return <FileBox className="h-3 w-3" />;
  }
}

function getExportLabel(type: string) {
  switch (type) {
    case "n4a_bundle":
      return "Bundle";
    case "pipeline_json":
      return "Pipeline";
    case "summary_json":
      return "Summary";
    case "predictions_csv":
      return "Predictions";
    default:
      return type;
  }
}

export interface WorkspaceDiscoveryPanelProps {
  workspaceId: string | null;
  className?: string;
}

export function WorkspaceDiscoveryPanel({
  workspaceId,
  className = "",
}: WorkspaceDiscoveryPanelProps) {
  const [runs, setRuns] = useState<DiscoveredRun[]>([]);
  const [exports, setExports] = useState<DiscoveredExport[]>([]);
  const [predictions, setPredictions] = useState<DiscoveredPrediction[]>([]);
  const [templates, setTemplates] = useState<DiscoveredTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) {
      setRuns([]);
      setExports([]);
      setPredictions([]);
      setTemplates([]);
      return;
    }

    const loadData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [runsRes, exportsRes, predsRes, templatesRes] = await Promise.all([
          getN4AWorkspaceRuns(workspaceId),
          getN4AWorkspaceExports(workspaceId),
          getN4AWorkspacePredictions(workspaceId),
          getN4AWorkspaceTemplates(workspaceId),
        ]);
        setRuns(runsRes.runs);
        setExports(exportsRes.exports);
        setPredictions(predsRes.predictions);
        setTemplates(templatesRes.templates);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [workspaceId]);

  if (!workspaceId) {
    return (
      <div className={"text-sm text-muted-foreground p-4 text-center " + className}>
        Select a workspace to view discovered content.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={"flex items-center justify-center p-6 " + className}>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={"flex items-center gap-2 p-4 text-destructive " + className}>
        <AlertCircle className="h-5 w-5" />
        <span>{error}</span>
      </div>
    );
  }

  const hasContent = runs.length > 0 || exports.length > 0 || predictions.length > 0 || templates.length > 0;

  if (!hasContent) {
    return (
      <div className={"text-sm text-muted-foreground p-4 text-center " + className}>
        No runs, exports, or predictions found in this workspace.
      </div>
    );
  }

  return (
    <div className={"space-y-1 " + className}>
      {runs.length > 0 && (
        <DiscoverySection
          title="Runs"
          icon={<Play className="h-4 w-4 text-blue-500" />}
          count={runs.length}
          defaultOpen={true}
        >
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {runs.slice(0, 10).map((run) => (
              <div
                key={run.id}
                className="flex items-center justify-between text-xs p-1.5 rounded hover:bg-muted/50"
              >
                <div className="flex-1 min-w-0">
                  <span className="font-medium truncate block">{run.name}</span>
                  <span className="text-muted-foreground">{run.dataset}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span>{run.artifact_count} artifacts</span>
                  {run.created_at && (
                    <span>{formatRelativeTime(run.created_at)}</span>
                  )}
                </div>
              </div>
            ))}
            {runs.length > 10 && (
              <p className="text-xs text-muted-foreground text-center py-1">
                + {runs.length - 10} more runs
              </p>
            )}
          </div>
        </DiscoverySection>
      )}

      {exports.length > 0 && (
        <DiscoverySection
          title="Exports"
          icon={<FileBox className="h-4 w-4 text-green-500" />}
          count={exports.length}
        >
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {exports.slice(0, 10).map((exp, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between text-xs p-1.5 rounded hover:bg-muted/50"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {getExportIcon(exp.type)}
                  <span className="font-medium truncate">
                    {exp.name || exp.model_name || "Export"}
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    {getExportLabel(exp.type)}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span>{exp.dataset}</span>
                  {exp.size_bytes && (
                    <span>{formatBytes(exp.size_bytes)}</span>
                  )}
                </div>
              </div>
            ))}
            {exports.length > 10 && (
              <p className="text-xs text-muted-foreground text-center py-1">
                + {exports.length - 10} more exports
              </p>
            )}
          </div>
        </DiscoverySection>
      )}

      {predictions.length > 0 && (
        <DiscoverySection
          title="Predictions"
          icon={<Database className="h-4 w-4 text-purple-500" />}
          count={predictions.length}
        >
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {predictions.map((pred, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between text-xs p-1.5 rounded hover:bg-muted/50"
              >
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{pred.dataset}</span>
                  <Badge variant="outline" className="ml-2 text-[10px]">
                    {pred.format}
                  </Badge>
                </div>
                <span className="text-muted-foreground">
                  {formatBytes(pred.size_bytes)}
                </span>
              </div>
            ))}
          </div>
        </DiscoverySection>
      )}

      {templates.length > 0 && (
        <DiscoverySection
          title="Templates"
          icon={<FileCode className="h-4 w-4 text-orange-500" />}
          count={templates.length}
        >
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {templates.map((tmpl, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between text-xs p-1.5 rounded hover:bg-muted/50"
              >
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{tmpl.name}</span>
                  <Badge variant="outline" className="ml-2 text-[10px]">
                    {tmpl.type.replace("_", " ")}
                  </Badge>
                </div>
                {tmpl.steps_count && (
                  <span className="text-muted-foreground">
                    {tmpl.steps_count} steps
                  </span>
                )}
              </div>
            ))}
          </div>
        </DiscoverySection>
      )}
    </div>
  );
}

export default WorkspaceDiscoveryPanel;
