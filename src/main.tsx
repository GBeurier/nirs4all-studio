import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "@/context/ThemeContext";
import { DeveloperModeProvider } from "@/context/DeveloperModeContext";
import { UISettingsProvider } from "@/context/UISettingsContext";
import { LanguageProvider } from "@/context/LanguageContext";
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemeProvider defaultTheme="system" storageKey="nirs4all-theme">
          <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
            <LanguageProvider>
              <UISettingsProvider>
                <DeveloperModeProvider>
                  <App />
                  <Toaster position="bottom-right" />
                </DeveloperModeProvider>
              </UISettingsProvider>
            </LanguageProvider>
          </Suspense>
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
