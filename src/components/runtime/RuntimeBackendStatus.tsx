import { useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { useTranslation } from "react-i18next";

import { getRuntimeSummary } from "@/api/system";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { STRICT_NATIVE_RUNTIME_ENGINE } from "@/lib/runtimeBackendPreference";

type NativeRuntimeStatus = "checking" | "available" | "unavailable";

export interface RuntimeBackendStatusProps {
  className?: string;
  compact?: boolean;
}

/** Read-only developer diagnostic for Studio's mandatory native runtime. */
export function RuntimeBackendStatus({
  className,
  compact = false,
}: RuntimeBackendStatusProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<NativeRuntimeStatus>("checking");

  useEffect(() => {
    let active = true;
    void getRuntimeSummary()
      .then((summary) => {
        if (!active) return;
        const capabilities = summary.runtime_engine_capabilities;
        setStatus(
          capabilities?.supports_explicit_run_engine === true
            && capabilities.supported_engines.includes(STRICT_NATIVE_RUNTIME_ENGINE)
            ? "available"
            : "unavailable",
        );
      })
      .catch(() => {
        if (active) setStatus("unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  const statusLabel = status === "checking"
    ? t("runs.runtime.checking")
    : status === "available"
      ? t("runs.runtime.available")
      : t("runs.runtime.unavailable");

  return (
    <div
      className={cn("rounded-lg border bg-muted/20 p-3", compact ? "space-y-2" : "space-y-3", className)}
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{t("runs.runtime.analysisEngine")}</span>
        </div>
        <Badge variant={status === "available" ? "default" : "secondary"}>
          {statusLabel}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("runs.runtime.analysisEngineHint")}
      </p>
    </div>
  );
}
