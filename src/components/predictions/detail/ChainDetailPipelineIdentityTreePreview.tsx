import {
  Boxes,
  Cpu,
  GitBranch,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatParamValue } from "./ChainDetailPipelineIdentityFormatting";
import type {
  PipelineIdentityStats,
  PipelineIdentityTree,
  PipelineIdentityTreeNode,
} from "./ChainDetailPipelineIdentityTypes";

interface ChainDetailPipelineTreePreviewProps {
  pipelineStats: PipelineIdentityStats;
  pipelineTree: PipelineIdentityTree;
}

export function ChainDetailPipelineTreePreview({
  pipelineStats,
  pipelineTree,
}: ChainDetailPipelineTreePreviewProps) {
  return (
    <div className="mt-4 rounded-xl border border-border/60 bg-background/65 p-3">
      <div className="grid grid-cols-4 gap-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2">
        <PipelineStat label="ops" value={pipelineStats.operators} />
        <PipelineStat label="models" value={pipelineStats.models} />
        <PipelineStat label="branches" value={pipelineStats.branches} />
        <PipelineVariantStat pipelineStats={pipelineStats} />
      </div>
      {pipelineTree.nodes.length > 0 && (
        <PipelineTreeNodes pipelineTree={pipelineTree} />
      )}
    </div>
  );
}

function PipelineStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col">
      <span className="text-sm font-semibold tabular-nums leading-none text-foreground">
        {value}
      </span>
      <span className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function PipelineVariantStat({ pipelineStats }: { pipelineStats: PipelineIdentityStats }) {
  return (
    <div className="flex flex-col">
      <span
        className={cn(
          "font-semibold tabular-nums leading-none",
          pipelineStats.hasGenerators ? "text-base text-primary" : "text-sm text-foreground",
        )}
      >
        {pipelineStats.hasGenerators ? pipelineStats.variants : 1}
      </span>
      <span className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        variants
      </span>
    </div>
  );
}

function PipelineTreeNodes({ pipelineTree }: { pipelineTree: PipelineIdentityTree }) {
  const hiddenStepCount = pipelineTree.total - pipelineTree.nodes.length;

  return (
    <ul className="mt-3 space-y-1 text-xs">
      {pipelineTree.nodes.map((node) => (
        <PipelineTreeNode key={node.id} node={node} />
      ))}
      {hiddenStepCount > 0 && (
        <li className="pl-0.5 text-[11px] italic text-muted-foreground/70">
          + {hiddenStepCount} more step
          {hiddenStepCount === 1 ? "" : "s"}
        </li>
      )}
    </ul>
  );
}

function PipelineTreeNode({ node }: { node: PipelineIdentityTreeNode }) {
  return (
    <li
      className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground"
      style={{ paddingLeft: `${node.depth * 12}px` }}
    >
      <PipelineTreeNodeIcon kind={node.kind} />
      <span className="truncate font-medium text-foreground/85">{node.label}</span>
      {node.hasGenerator && (
        <span title="Selected from a sweep / generator" className="inline-flex">
          <Sparkles className="h-3 w-3 shrink-0 text-amber-500" aria-label="sweep / generator" />
        </span>
      )}
      {node.params.length > 0 && (
        <span className="flex flex-wrap items-center gap-1">
          {node.params.map(([key, value]) => (
            <span
              key={key}
              className="inline-flex items-baseline gap-1 rounded-sm border border-border/40 bg-muted/40 px-1 py-0 font-mono text-[10px]"
              title={`${key}=${formatParamValue(value)}`}
            >
              <span className="text-muted-foreground">{key}</span>
              <span className="text-foreground/90">{formatParamValue(value)}</span>
            </span>
          ))}
        </span>
      )}
    </li>
  );
}

function PipelineTreeNodeIcon({ kind }: { kind: PipelineIdentityTreeNode["kind"] }) {
  if (kind === "branch") {
    return <GitBranch className="h-3 w-3 shrink-0 text-accent" />;
  }
  if (kind === "model") {
    return <Cpu className="h-3 w-3 shrink-0 text-primary" />;
  }
  return <Boxes className="h-3 w-3 shrink-0 text-muted-foreground/70" />;
}
