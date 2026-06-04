import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter } from "react-router-dom";

// Use HashRouter for Electron (file:// protocol doesn't support BrowserRouter)
const isElectron = typeof window !== "undefined" && (window as unknown as { electronApi?: unknown }).electronApi !== undefined;
const Router = isElectron ? HashRouter : BrowserRouter;
import { ThemeProvider } from "@/context/ThemeContext";
import { DeveloperModeProvider } from "@/context/DeveloperModeContext";
import { DiagnosticsConsentProvider } from "@/context/DiagnosticsConsentContext";
import { UISettingsProvider } from "@/context/UISettingsContext";
import { LanguageProvider } from "@/context/LanguageContext";
import { ActiveRunProvider } from "@/context/ActiveRunContext";
import { Toaster } from "@/components/ui/sonner";
import * as Sentry from "@sentry/react";
import { captureDiagnosticsError, initDiagnostics } from "@/lib/diagnostics";
import App from "./App";
import "./index.css";

// Initialize i18n
import "@/lib/i18n";

initDiagnostics();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router>
        <ThemeProvider defaultTheme="system" storageKey="nirs4all-theme">
          <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
            <LanguageProvider>
              <UISettingsProvider>
                <DiagnosticsConsentProvider>
                  <DeveloperModeProvider>
                    <ActiveRunProvider>
                      <Sentry.ErrorBoundary
                        fallback={
                          <div className="flex h-screen items-center justify-center bg-background p-6 text-foreground">
                            <div className="max-w-md space-y-2 text-center">
                              <h1 className="text-xl font-semibold">Something went wrong</h1>
                              <p className="text-sm text-muted-foreground">
                                Restart the application or reload the page.
                              </p>
                            </div>
                          </div>
                        }
                        onError={(error, componentStack) => {
                          captureDiagnosticsError(error, {
                            tags: { surface: "react_error_boundary" },
                            extra: { componentStack },
                          });
                        }}
                      >
                        <App />
                      </Sentry.ErrorBoundary>
                      <Toaster position="bottom-right" />
                    </ActiveRunProvider>
                  </DeveloperModeProvider>
                </DiagnosticsConsentProvider>
              </UISettingsProvider>
            </LanguageProvider>
          </Suspense>
        </ThemeProvider>
      </Router>
    </QueryClientProvider>
  </StrictMode>
);
