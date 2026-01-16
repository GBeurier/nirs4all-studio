import { Outlet } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar } from "./AppSidebar";
import { AppHeader } from "./AppHeader";
import { FloatingRunWidget } from "./FloatingRunWidget";

export function AppLayout() {
  return (
    <TooltipProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background">
        {/* Desktop Sidebar - hidden on mobile */}
        <div className="hidden md:block">
          <AppSidebar />
        </div>
        <div className="flex flex-1 flex-col overflow-hidden">
          <AppHeader />
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
