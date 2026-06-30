import type { ReactNode } from "react";

interface ChainDetailIdentityRowsProps {
  branchPathLabel: string | null;
  generatorChoiceCount: number;
  modelClass: string | null;
  pipelineName: string | null;
}

export function ChainDetailIdentityRows({
  branchPathLabel,
  generatorChoiceCount,
  modelClass,
  pipelineName,
}: ChainDetailIdentityRowsProps) {
  return (
    <>
      {(branchPathLabel || generatorChoiceCount > 0) && (
        <div className="mt-4 space-y-2 text-sm">
          {branchPathLabel && (
            <KeyValueRow k="Branch path">
              <span className="font-mono text-xs">{branchPathLabel}</span>
            </KeyValueRow>
          )}
          {generatorChoiceCount > 0 && (
            <KeyValueRow k="Pipeline variants">
              <span className="text-xs">{generatorChoiceCount} expanded</span>
            </KeyValueRow>
          )}
        </div>
      )}

      {(modelClass || pipelineName) && (
        <div className="mt-4 space-y-2 text-sm">
          {modelClass && (
            <KeyValueRow k="Class">
              <span className="font-mono text-xs">{modelClass}</span>
            </KeyValueRow>
          )}
          {pipelineName && pipelineName !== modelClass && (
            <KeyValueRow k="Pipeline">{pipelineName}</KeyValueRow>
          )}
        </div>
      )}
    </>
  );
}

function KeyValueRow({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0 text-sm">
      <div className="text-muted-foreground">{k}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
