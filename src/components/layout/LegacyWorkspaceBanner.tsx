import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ExternalLink, X } from "lucide-react";

import { getWorkspaceFormatStatus } from "@/api/workspace";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  clientStorageKeys,
  readClientStorageJson,
  writeClientStorageJson,
} from "@/lib/clientStorage";

const CONVERTER_URL = "https://github.com/GBeurier/nirs4all-tools";
const CONVERTER_COMMANDS = [
  'pip install "nirs4all-tools[duckdb,parquet]"',
  "nirs4all-tools workspace convert <workspace> --output <new-folder> --verify",
].join("\n");

function dismissedPaths(): string[] {
  return readClientStorageJson(clientStorageKeys.dismissedLegacyWorkspaceNotices) ?? [];
}

/**
 * One-time notice for a DuckDB workspace, which Studio no longer opens. It only
 * points to the separate nirs4all-tools converter; Studio offers no conversion.
 */
export function LegacyWorkspaceBanner() {
  const { t } = useTranslation();
  const [legacyPath, setLegacyPath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getWorkspaceFormatStatus()
      .then(({ path, legacy_duckdb }) => {
        if (!cancelled && legacy_duckdb && path && !dismissedPaths().includes(path)) {
          setLegacyPath(path);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!legacyPath) {
    return null;
  }

  const dismiss = () => {
    writeClientStorageJson(clientStorageKeys.dismissedLegacyWorkspaceNotices, [
      ...dismissedPaths(),
      legacyPath,
    ]);
    setLegacyPath(null);
  };

  return (
    <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/30 md:px-6">
      <Alert className="mx-auto max-w-7xl border-amber-300 bg-background/80 text-amber-950 dark:border-amber-900 dark:text-amber-100">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <AlertTitle>{t("layout.legacyWorkspace.title")}</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>{t("layout.legacyWorkspace.body")}</p>
              <pre className="overflow-x-auto rounded bg-muted px-2 py-1 text-xs">{CONVERTER_COMMANDS}</pre>
              <a
                href={CONVERTER_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 underline"
              >
                {t("layout.legacyWorkspace.docs")}
                <ExternalLink className="h-3 w-3" />
              </a>
            </AlertDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label={t("layout.legacyWorkspace.dismiss")}
            onClick={dismiss}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </Alert>
    </div>
  );
}

export default LegacyWorkspaceBanner;
