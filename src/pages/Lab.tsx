import { useTranslation } from "react-i18next";
import { MlLoadingOverlay } from "@/components/layout/MlLoadingOverlay";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Sparkles, ArrowLeftRight, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { TRANSFER_ENABLED } from "@/lib/featureFlags";
import { useShapAvailable } from "@/hooks/useBackendCapabilities";

const labTabs = [
  { titleKey: "lab.tabs.synthesis", href: "/lab/synthesis", icon: Sparkles },
  ...(TRANSFER_ENABLED
    ? [{ titleKey: "lab.tabs.transfer", href: "/lab/transfer", icon: ArrowLeftRight }]
    : []),
  { titleKey: "lab.tabs.shapley", href: "/lab/shapley", icon: TrendingUp },
];

export default function Lab() {
  const { t } = useTranslation();
  const location = useLocation();
  // The Shapley tab needs `shap` in the backend; lite builds ship without it.
  const shapAvailable = useShapAvailable();
  const tabs = shapAvailable ? labTabs : labTabs.filter((tab) => tab.href !== "/lab/shapley");

  return (
    <MlLoadingOverlay>
    <div className="h-full flex flex-col">
      {/* Tab navigation */}
      <div className="shrink-0 flex items-center gap-1 border-b border-border/50">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = location.pathname.startsWith(tab.href);
          return (
            <NavLink
              key={tab.href}
              to={tab.href}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              )}
            >
              <Icon className="h-4 w-4" />
              {t(tab.titleKey)}
            </NavLink>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 pt-4">
        <Outlet />
      </div>
    </div>
    </MlLoadingOverlay>
  );
}
