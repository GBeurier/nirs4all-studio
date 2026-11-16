import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { PythonEnvActivity } from "@/types/pythonEnvironment";

/** Progress of the environment action that is running, as reported by the main process. */
export function PythonEnvActivityStatus({
  activity,
  className,
}: {
  activity: PythonEnvActivity | undefined;
  className?: string;
}) {
  const { t } = useTranslation();
  const label = t(`pythonEnv.activity.${activity?.kind ?? "installing"}`);
  return (
    <div className={cn("space-y-1.5", className)} role="status" aria-live="polite">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {label}
        {typeof activity?.percent === "number" && (
          <span className="font-normal text-muted-foreground">{Math.round(activity.percent)}%</span>
        )}
      </p>
      {typeof activity?.percent === "number" ? (
        <Progress value={activity.percent} aria-label={label} />
      ) : (
        <div className="h-2 w-full overflow-hidden rounded-full bg-primary/20">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
        </div>
      )}
      {activity?.detail && (
        <p className="truncate text-xs text-muted-foreground" title={activity.detail}>{activity.detail}</p>
      )}
    </div>
  );
}
