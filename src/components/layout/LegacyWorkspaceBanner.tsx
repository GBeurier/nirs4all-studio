import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight } from "lucide-react";

import { getWorkspaceTransitionStatus } from "@/api/workspace";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { WorkspaceTransitionStatusResponse } from "@/types/storage";

export function LegacyWorkspaceBanner() {
  const [status, setStatus] =
    useState<WorkspaceTransitionStatusResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    getWorkspaceTransitionStatus()
      .then((nextStatus) => {
        if (!cancelled && nextStatus.conversion_required) {
          setStatus(nextStatus);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!status) {
    return null;
  }

  return (
    <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/30 md:px-6">
      <Alert className="mx-auto max-w-7xl border-amber-300 bg-background/80 text-amber-950 dark:border-amber-900 dark:text-amber-100">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <AlertTitle>Legacy workspace format detected</AlertTitle>
            <AlertDescription className="mt-1">
              {status.message}
            </AlertDescription>
          </div>
          <Button asChild size="sm" variant="outline" className="shrink-0">
            <Link to="/settings?tab=workspaces">
              Convert workspace
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </Alert>
    </div>
  );
}

export default LegacyWorkspaceBanner;
