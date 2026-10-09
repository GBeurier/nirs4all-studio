import { useEffect, useRef, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SentryErrorBoundary } from "@/lib/sentry";

interface RouteErrorFallbackProps {
  error: unknown;
  resetError: () => void;
}

function RouteErrorFallback({ error, resetError }: RouteErrorFallbackProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const failedPathname = useRef(pathname);

  // Navigating elsewhere (sidebar, browser history) leaves the failed page.
  useEffect(() => {
    if (pathname !== failedPathname.current) resetError();
  }, [pathname, resetError]);

  const details = error instanceof Error ? (error.stack ?? error.message) : String(error);

  return (
    <div role="alert" className="mx-auto flex max-w-xl flex-col items-center gap-4 py-16 text-center">
      <AlertTriangle className="h-10 w-10 text-destructive" aria-hidden="true" />
      <h1 className="text-xl font-semibold">{t("layout.routeError.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("layout.routeError.description")}</p>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => navigate(-1)}>
          {t("layout.routeError.back")}
        </Button>
        <Button onClick={() => window.location.reload()}>{t("layout.routeError.reload")}</Button>
      </div>
      <details className="w-full text-left">
        <summary className="cursor-pointer text-sm text-muted-foreground">{t("layout.routeError.details")}</summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">{details}</pre>
      </details>
    </div>
  );
}

/** Keeps the sidebar usable when a page crashes. */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <SentryErrorBoundary
      fallback={({ error, resetError }) => <RouteErrorFallback error={error} resetError={resetError} />}
    >
      {children}
    </SentryErrorBoundary>
  );
}
