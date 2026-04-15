import { Outlet } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar } from "./AppSidebar";
import { BackendStartupBanner } from "./BackendStartupBanner";
import { FloatingRunWidget } from "./FloatingRunWidget";
import { OfflineIndicator } from "./OfflineIndicator";
import { useStartupUpdateCheck } from "@/hooks/useStartupUpdateCheck";

export function AppLayout() {
  useStartupUpdateCheck();

  return (
    <TooltipProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background">
        {/* Desktop Sidebar - hidden on mobile */}
        <div className="hidden md:block">
          <AppSidebar />
        </div>
        <div className="flex flex-1 flex-col overflow-hidden">
          <BackendStartupBanner />
          <div className="fixed right-4 top-3 z-50">
            <OfflineIndicator />
          </div>
          <main className="flex-1 overflow-auto p-4 md:p-6">
            <div className="h-full">
              <Outlet />
            </div>
          </main>
        </div>
        {/* Floating run progress widget */}
        <FloatingRunWidget />
      </div>
    </TooltipProvider>
  );
}
