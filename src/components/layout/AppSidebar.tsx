import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Database,
  FlaskConical,
  GitBranch,
  Pencil,
  Search,
  Play,
  BarChart3,
  Layers,
  Target,
  Beaker,
  Settings,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";

interface NavItem {
  titleKey: string;
  href: string;
  icon: LucideIcon;
  badge?: number;
}

const dataNavItems: NavItem[] = [
  { titleKey: "nav.datasets", href: "/datasets", icon: Database },
  { titleKey: "nav.pipelines", href: "/pipelines", icon: GitBranch },
  { titleKey: "nav.pipelineEditor", href: "/pipelines/new", icon: Pencil },
];

const exploreNavItems: NavItem[] = [
  { titleKey: "nav.playground", href: "/playground", icon: FlaskConical },
  { titleKey: "nav.inspector", href: "/inspector", icon: Search },
];

const resultsNavItems: NavItem[] = [
  { titleKey: "nav.runs", href: "/runs", icon: Play },
  { titleKey: "nav.scores", href: "/results", icon: BarChart3 },
  { titleKey: "nav.aggregatedResults", href: "/results/aggregated", icon: Layers },
  { titleKey: "nav.predictions", href: "/predictions", icon: Target },
];

const labNavItems: NavItem[] = [
  { titleKey: "nav.lab", href: "/lab", icon: Beaker },
];

export function AppSidebar() {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  const isActive = (href: string) => {
    if (href === "/pipelines/new") {
      return location.pathname.startsWith("/pipelines/");
    }
    if (href === "/pipelines") {
      return location.pathname === "/pipelines";
    }
    if (href === "/results") {
      return location.pathname === "/results";
    }
    if (href === "/results/aggregated") {
      return location.pathname === "/results/aggregated";
    }
    return location.pathname.startsWith(href);
  };

  const renderNavItem = (item: NavItem) => {
    const active = isActive(item.href);
    const Icon = item.icon;
    const title = t(item.titleKey);

    const linkContent = (
      <NavLink
        to={item.href}
        className={cn(
          "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200",
          active
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
      >
        {active && (
          <div className="absolute left-0 top-0 h-full w-1 rounded-r-full bg-primary" />
        )}
        <Icon className={cn("h-5 w-5 shrink-0", active && "text-primary")} />
        {!collapsed && (
          <span className="truncate">{title}</span>
        )}
        {!collapsed && item.badge !== undefined && item.badge > 0 && (
          <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-xs font-medium text-primary">
            {item.badge}
          </span>
        )}
      </NavLink>
    );

    if (collapsed) {
      return (
        <Tooltip key={item.href} delayDuration={0}>
          <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
          <TooltipContent side="right" className="flex items-center gap-2">
            {title}
            {item.badge !== undefined && item.badge > 0 && (
              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-xs">
                {item.badge}
              </span>
            )}
          </TooltipContent>
        </Tooltip>
      );
    }

    return <div key={item.href}>{linkContent}</div>;
  };

  const renderNavGroup = (titleKey: string, items: NavItem[]) => (
    <div className="space-y-1">
      {!collapsed && (
        <h3 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
          {t(titleKey)}
        </h3>
      )}
      {items.map(renderNavItem)}
    </div>
  );

  return (
    <div
      className={cn(
        "relative flex h-full flex-col border-r border-border/50 bg-sidebar transition-all duration-300",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Logo */}
      <div className="flex h-40 items-center justify-center border-b border-border/50 px-2">
        <img
          src="/nirs4all_logo.png"
          alt="nirs4all Studio"
          className="h-32 w-full object-contain"
        />
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 px-3 py-4">
        <div className="space-y-6">
          {renderNavGroup("layout.sidebar.groups.data", dataNavItems)}
          <Separator className="mx-3" />
          {renderNavGroup("layout.sidebar.groups.explore", exploreNavItems)}
          <Separator className="mx-3" />
          {renderNavGroup("layout.sidebar.groups.results", resultsNavItems)}
          <Separator className="mx-3" />
          {renderNavGroup("layout.sidebar.groups.lab", labNavItems)}
        </div>
      </ScrollArea>

      {/* Settings at bottom */}
      <div className="border-t border-border/50 p-3">
        {renderNavItem({ titleKey: "nav.settings", href: "/settings", icon: Settings })}
      </div>

      {/* Collapse button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-20 z-10 h-6 w-6 rounded-full border border-border bg-background shadow-sm hover:bg-muted"
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3" />
        ) : (
          <ChevronLeft className="h-3 w-3" />
        )}
      </Button>
    </div>
  );
}
