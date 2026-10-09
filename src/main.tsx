import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter } from "react-router-dom";

import { omitReactPerformancePropDiff } from "@/lib/reactPerformanceMeasure";

// Install before rendering: React's development tracks otherwise clone spectra
// and graphics handles in changed props before the old crash guard can react.
if (import.meta.env.DEV && typeof performance !== "undefined" && typeof performance.measure === "function") {
  performance.measure = omitReactPerformancePropDiff(performance.measure.bind(performance));
}

// Initialize Sentry crash reporting only when the user has opted in.
import { initSentry, SentryErrorBoundary, SentryFallback } from "@/lib/sentry";
import { getTelemetryConsentStatus } from "@/lib/telemetryConsent";
import { migrateRetiredRuntimeBackendPreference } from "@/lib/runtimeBackendPreference";

// Use HashRouter for Electron (file:// protocol doesn't support BrowserRouter)
const isElectron = typeof window !== "undefined" && (window as unknown as { electronApi?: unknown }).electronApi !== undefined;
const Router = isElectron ? HashRouter : BrowserRouter;
import { hydrateDatasetCachesFromStorage } from "@/hooks/useDatasetQueries";
import { ThemeProvider } from "@/context/ThemeContext";
import { DeveloperModeProvider } from "@/context/DeveloperModeContext";
import { UISettingsProvider } from "@/context/UISettingsContext";
import { LanguageProvider } from "@/context/LanguageContext";
import { ActiveRunProvider } from "@/context/ActiveRunContext";
import { MlReadinessProvider } from "@/context/MlReadinessContext";
import { Toaster } from "@/components/ui/sonner";
import App from "./App";
import "./index.css";

// Initialize i18n
import { i18nReady } from "@/lib/i18n";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: (failureCount, error) => {
        const status = error && typeof error === "object" && "status" in error
          ? (error as { status: number }).status
          : 0;
        // Retry 503 (ML loading) and network errors (no status) during startup
        if (status === 503 || status === 0) {
          return failureCount < 8;
        }
        return failureCount < 1;
      },
      retryDelay: (attemptIndex) => Math.min(1500 * 2 ** attemptIndex, 15000),
    },
  },
});

// Hydrate the dataset list / linked-workspaces caches from localStorage BEFORE
// React mounts. Without this, every cold start would render an empty Datasets
// page until the first HTTP round-trip completed; with it, the previous
// session's list is on screen instantly and React Query refetches in the
// background to correct any drift.
hydrateDatasetCachesFromStorage(queryClient);
migrateRetiredRuntimeBackendPreference();

const appTree = (
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router>
        <ThemeProvider defaultTheme="system" storageKey="nirs4all-theme">
          <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
            <LanguageProvider>
              <UISettingsProvider>
                <DeveloperModeProvider>
                  <ActiveRunProvider>
                    <MlReadinessProvider>
                      <App />
                      <Toaster position="bottom-right" />
                    </MlReadinessProvider>
                  </ActiveRunProvider>
                </DeveloperModeProvider>
              </UISettingsProvider>
            </LanguageProvider>
          </Suspense>
        </ThemeProvider>
      </Router>
    </QueryClientProvider>
  </StrictMode>
);

function renderSentryFallback({ error }: { error: unknown }) {
  return (
    <SentryFallback
      error={error instanceof Error ? error : new Error(String(error))}
    />
  );
}

void (async () => {
  try {
    const telemetryConsent = await getTelemetryConsentStatus();
    if (telemetryConsent === "accepted") {
      initSentry();
    }
  } catch {
    // Consent defaults to unset/disabled if the preference cannot be read.
  }

  await i18nReady;

  createRoot(document.getElementById("root")!).render(
    <SentryErrorBoundary fallback={renderSentryFallback}>{appTree}</SentryErrorBoundary>
  );
})();
