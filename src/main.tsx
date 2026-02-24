import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter } from "react-router-dom";

// Initialize Sentry crash reporting before anything else renders
import { initSentry, SentryErrorBoundary, SentryFallback, sentryEnabled } from "@/lib/sentry";
initSentry();

// Use HashRouter for Electron (file:// protocol doesn't support BrowserRouter)
const isElectron = typeof window !== "undefined" && (window as unknown as { electronApi?: unknown }).electronApi !== undefined;
const Router = isElectron ? HashRouter : BrowserRouter;
import { ThemeProvider } from "@/context/ThemeContext";
import { DeveloperModeProvider } from "@/context/DeveloperModeContext";
import { UISettingsProvider } from "@/context/UISettingsContext";
import { LanguageProvider } from "@/context/LanguageContext";
import { ActiveRunProvider } from "@/context/ActiveRunContext";
import { Toaster } from "@/components/ui/sonner";
import App from "./App";
import "./index.css";

// Initialize i18n
import "@/lib/i18n";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
});

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
                    <App />
                    <Toaster position="bottom-right" />
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

createRoot(document.getElementById("root")!).render(
  sentryEnabled
    ? <SentryErrorBoundary fallback={SentryFallback}>{appTree}</SentryErrorBoundary>
    : appTree
);
