import { AlertCircle, AlertTriangle, Info } from "lucide-react";
import { RuntimeDiagnosticList as SharedRuntimeDiagnosticList } from "nirs4all-ui/components";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  formatRuntimeTokenLabel,
  normalizeRuntimeDiagnostics,
  type RuntimeDiagnosticItem,
  type RuntimeDiagnosticTone,
} from "@/ui/runtime";

const diagnosticToneClasses: Record<RuntimeDiagnosticTone, {
  container: string;
  icon: string;
}> = {
  error: {
    container: "border-destructive/30 bg-destructive/5",
    icon: "text-destructive",
  },
  warning: {
    container: "border-amber-500/30 bg-amber-500/5",
    icon: "text-amber-600",
  },
  info: {
    container: "border-border bg-muted/20",
    icon: "text-muted-foreground",
  },
};

const diagnosticIcons = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
} as const;

function RuntimeDiagnosticRow({ diagnostic }: { diagnostic: RuntimeDiagnosticItem }) {
  const tone = diagnosticToneClasses[diagnostic.tone];
  const Icon = diagnosticIcons[diagnostic.tone];

  return (
    <div className={cn("rounded-md border px-3 py-2", tone.container)}>
      <div className="flex items-start gap-2">
        <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", tone.icon)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {diagnostic.cause && (
              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                {formatRuntimeTokenLabel(diagnostic.cause)}
              </Badge>
            )}
            {diagnostic.verb && (
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                {formatRuntimeTokenLabel(diagnostic.verb)}
              </Badge>
            )}
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{diagnostic.message}</p>
          {diagnostic.mitigation && (
            <p className="mt-1 text-xs text-muted-foreground">{diagnostic.mitigation}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function RuntimeDiagnosticsList({
  source,
  diagnostics,
  title = "Runtime Diagnostics",
  className,
}: {
  source?: unknown;
  diagnostics?: RuntimeDiagnosticItem[];
  title?: string;
  className?: string;
}) {
  const items = diagnostics ?? normalizeRuntimeDiagnostics(source);
  if (items.length === 0) return null;

  return (
    <div className={cn("space-y-2", className)}>
      <h4 className="flex items-center gap-2 text-sm font-medium">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        {title}
      </h4>
      <SharedRuntimeDiagnosticList
        diagnostics={items}
        className="space-y-2"
        renderItem={(diagnostic) => <RuntimeDiagnosticRow diagnostic={diagnostic} />}
      />
    </div>
  );
}
