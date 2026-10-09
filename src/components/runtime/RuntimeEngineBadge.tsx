import { AlertTriangle, Cpu } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RuntimeEngineBadge as SharedRuntimeEngineBadge } from "nirs4all-ui/components";

import { badgeVariants } from "@/components/ui/badgeVariants";
import { cn } from "@/lib/utils";
import {
  buildRuntimeEngineStatus,
  type RuntimeEngineStatusView,
  type RuntimeEngineTone,
} from "@/ui/runtime";

const engineToneClasses: Record<RuntimeEngineTone, string> = {
  default: "bg-muted/30 text-foreground border-border",
  success: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  warning: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  muted: "bg-muted/40 text-muted-foreground border-border",
};

export function RuntimeEngineBadge({
  source,
  status,
  className,
}: {
  source?: unknown;
  status?: RuntimeEngineStatusView | null;
  className?: string;
}) {
  const { t } = useTranslation();
  const engineStatus = status ?? buildRuntimeEngineStatus(source);
  if (!engineStatus) return null;

  const label = engineStatus.isFallback
    ? t("runs.runtime.engineFallback", { engine: engineStatus.engineLabel })
    : engineStatus.engineLabel ?? t("runs.runtime.engineRequested", { engine: engineStatus.requestedEngineLabel });
  const title = [
    engineStatus.engineLabel ? t("runs.runtime.engineTitle", { engine: engineStatus.engineLabel }) : null,
    engineStatus.detailLabel && engineStatus.requestedEngineLabel
      ? t("runs.runtime.engineRequested", { engine: engineStatus.requestedEngineLabel })
      : null,
    engineStatus.diagnostics.length > 0
      ? t("runs.runtime.diagnosticCount", { count: engineStatus.diagnostics.length })
      : null,
  ].filter(Boolean).join("\n");

  return (
    <SharedRuntimeEngineBadge
      status={engineStatus}
      label={label}
      title={title || undefined}
      defaultIcon={<Cpu className="h-3 w-3" />}
      fallbackIcon={<AlertTriangle className="h-3 w-3" />}
      className={cn(badgeVariants({ variant: "outline" }), "gap-1.5 text-[10px]", engineToneClasses[engineStatus.tone], className)}
    />
  );
}
