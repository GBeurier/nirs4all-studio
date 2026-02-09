import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Sparkles, ArrowLeftRight, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

const labTabs = [
  { titleKey: "lab.tabs.synthesis", href: "/lab/synthesis", icon: Sparkles },
  { titleKey: "lab.tabs.transfer", href: "/lab/transfer", icon: ArrowLeftRight },
  { titleKey: "lab.tabs.shapley", href: "/lab/shapley", icon: TrendingUp },
] as const;

export default function Lab() {
  const { t } = useTranslation();
  const location = useLocation();

  return (
    <div className="space-y-4">
      {/* Tab navigation */}
      <div className="flex items-center gap-1 border-b border-border/50">
        {labTabs.map((tab) => {
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
      <Outlet />
    </div>
  );
}
