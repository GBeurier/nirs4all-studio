import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { RefreshCw, Terminal } from "lucide-react";

import { getSystemInfo } from "@/api/system";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Read-only summary outside the desktop application, where the deployment owns the environment. */
export function PythonEnvDeploymentSummary() {
  const { t } = useTranslation();
  const info = useQuery({
    queryKey: ["system", "info"],
    queryFn: getSystemInfo,
    retry: false,
  });
  const available = info.data && info.data.python_available !== false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Terminal className="h-5 w-5" />
          {t("pythonEnv.current.title")}
        </CardTitle>
        <CardDescription>{t("pythonEnv.deployment.managed")}</CardDescription>
      </CardHeader>
      <CardContent>
        {info.isPending ? (
          <div className="space-y-2" role="status" aria-label={t("pythonEnv.current.loading")}>
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-4 w-80" />
            <Skeleton className="h-4 w-40" />
          </div>
        ) : info.isError ? (
          <div className="flex flex-wrap items-center gap-3">
            <p role="alert" className="text-sm text-destructive">{t("pythonEnv.deployment.loadFailed")}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void info.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("common.retry")}
            </Button>
          </div>
        ) : !available ? (
          <p className="text-sm text-muted-foreground">{t("pythonEnv.deployment.unavailable")}</p>
        ) : (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t("pythonEnv.deployment.interpreter")}</dt>
            <dd className="truncate font-mono text-xs leading-5" title={info.data.python.executable}>{info.data.python.executable}</dd>
            <dt className="text-muted-foreground">{t("pythonEnv.current.python")}</dt>
            <dd>{info.data.python.version.split(" ")[0]}</dd>
            <dt className="text-muted-foreground">nirs4all</dt>
            <dd>{info.data.nirs4all_version || t("common.unknown")}</dd>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
