import {
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  Package,
  RotateCcw,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import type { WebappUpdateRowState } from "./UpdatesSectionLogic";

type WebappUpdateRowProps = {
  row: WebappUpdateRowState;
  onOpenDialog: () => void;
  onOpenInstaller: () => void;
};

export function WebappUpdateRow({
  row,
  onOpenDialog,
  onOpenInstaller,
}: WebappUpdateRowProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-primary" />
          <span className="font-medium">nirs4all Studio</span>
        </div>
        <div className="text-sm text-muted-foreground">
          {t("settings.updates.currentLabel")} <span className="font-mono">{row.currentVersion}</span>
          {row.showTargetVersion && (
            <>
              {" → "}
              <span className="font-mono text-primary">
                {row.targetVersion}
              </span>
              {row.isPrerelease && (
                <Badge variant="outline" className="text-xs py-0 ml-1">{t("settings.updates.preReleaseBadge")}</Badge>
              )}
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {row.action === "downloading" && (
          <Badge variant="secondary" className="flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t("settings.updates.downloadingPercent", { percent: row.downloadProgressPercent })}
          </Badge>
        )}

        {row.action === "apply" && (
          <Button size="sm" onClick={onOpenDialog}>
            <RotateCcw className="mr-2 h-4 w-4" />
            {t("settings.updates.applyUpdate")}
          </Button>
        )}

        {row.action === "update" && (
          <Button size="sm" onClick={onOpenDialog}>
            <Download className="mr-2 h-4 w-4" />
            {t("settings.updates.update")}
          </Button>
        )}

        {row.action === "installer" && (
          <Button size="sm" variant="outline" onClick={onOpenInstaller} disabled={!row.installerUrl}>
            <ExternalLink className="mr-2 h-4 w-4" />
            {t("settings.updates.getInstaller")}
          </Button>
        )}

        {row.action === "up-to-date" && (
          <Badge variant="outline" className="flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-green-500" />
            {t("settings.updates.upToDate")}
          </Badge>
        )}
      </div>
    </div>
  );
}
