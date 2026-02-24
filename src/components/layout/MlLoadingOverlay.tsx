/**
 * Overlay shown on pages that require ML dependencies when they are not yet loaded.
 * Renders children blurred with a centered loading indicator on top.
 * Disappears automatically when mlReady becomes true.
 */

import { useMlReadiness } from "@/context/MlReadinessContext";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

export function MlLoadingOverlay({ children }: { children: React.ReactNode }) {
  const { mlReady, mlLoading, mlError } = useMlReadiness();
  const { t } = useTranslation();

  if (mlReady) return <>{children}</>;

  return (
    <div className="relative h-full">
      {/* Render children but blur and disable interaction */}
      <div className="h-full opacity-30 pointer-events-none blur-sm">
        {children}
      </div>
      {/* Overlay */}
      <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm z-50">
        <div className="flex flex-col items-center gap-4 p-8 rounded-xl bg-card border shadow-lg max-w-md text-center">
          {mlLoading ? (
            <>
              <Loader2 className="h-10 w-10 animate-spin text-teal-500" />
              <h3 className="text-lg font-semibold">
                {t("ml.loading.title", "Loading ML Engine...")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t(
                  "ml.loading.description",
                  "Machine learning dependencies are being initialized. This page will be available in a moment."
                )}
              </p>
            </>
          ) : mlError ? (
            <>
              <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center">
                <span className="text-destructive text-xl font-bold">!</span>
              </div>
              <h3 className="text-lg font-semibold text-destructive">
                {t("ml.error.title", "ML Engine Error")}
              </h3>
              <p className="text-sm text-muted-foreground">{mlError}</p>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
