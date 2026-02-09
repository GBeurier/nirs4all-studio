import { useState, useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "@/lib/motion";
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
  Menu,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
}

const dataNavItems: NavItem[] = [
  { title: "Datasets", href: "/datasets", icon: Database },
  { title: "Pipelines", href: "/pipelines", icon: GitBranch },
  { title: "Pipeline Editor", href: "/pipelines/new", icon: Pencil },
];

const exploreNavItems: NavItem[] = [
  { title: "Playground", href: "/playground", icon: FlaskConical },
  { title: "Inspector", href: "/inspector", icon: Search },
];

const resultsNavItems: NavItem[] = [
  { title: "Runs", href: "/runs", icon: Play },
  { title: "Scores", href: "/results", icon: BarChart3 },
  { title: "Aggregated", href: "/results/aggregated", icon: Layers },
  { title: "Predictions", href: "/predictions", icon: Target },
];

const labNavItems: NavItem[] = [
  { title: "Lab", href: "/lab", icon: Beaker },
];

export function MobileSidebar() {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();

  // Close sidebar on route change
  useEffect(() => {
    setIsOpen(false);
  }, [location.pathname]);

  // Prevent body scroll when sidebar is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

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

    return (
      <NavLink
        key={item.href}
        to={item.href}
        onClick={() => setIsOpen(false)}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-3 text-base font-medium transition-colors",
          active
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
      >
        <Icon className={cn("h-5 w-5", active && "text-primary")} />
        <span>{item.title}</span>
      </NavLink>
    );
  };

  const renderNavGroup = (title: string, items: NavItem[]) => (
    <div className="space-y-1">
      <h3 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
        {title}
      </h3>
      {items.map(renderNavItem)}
    </div>
  );

  return (
    <>
      {/* Toggle Button - visible only on mobile */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsOpen(true)}
        className="md:hidden"
      >
        <Menu className="h-5 w-5" />
        <span className="sr-only">Open menu</span>
      </Button>

      {/* Overlay and Sidebar */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 z-40 bg-background/90 md:hidden"
            />

            {/* Sidebar */}
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed inset-y-0 left-0 z-50 w-72 border-r border-border bg-sidebar md:hidden"
            >
              {/* Header */}
              <div className="flex h-16 items-center justify-between border-b border-border/50 px-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
                    <span className="text-lg font-bold text-primary-foreground">
                      N
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-base font-semibold text-foreground">
                      nirs4all Studio
                    </span>
                    <span className="text-xs text-muted-foreground">
                      NIRS Analysis
                    </span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsOpen(false)}
                >
                  <X className="h-5 w-5" />
                  <span className="sr-only">Close menu</span>
                </Button>
              </div>

              {/* Navigation */}
              <ScrollArea className="flex-1 px-3 py-4">
                <div className="space-y-6">
                  {renderNavGroup("Data", dataNavItems)}
                  <Separator className="mx-3" />
                  {renderNavGroup("Explore", exploreNavItems)}
                  <Separator className="mx-3" />
                  {renderNavGroup("Results", resultsNavItems)}
                  <Separator className="mx-3" />
                  {renderNavGroup("Lab", labNavItems)}
                </div>
              </ScrollArea>

              {/* Settings at bottom */}
              <div className="border-t border-border/50 p-3">
                {renderNavItem({
                  title: "Settings",
                  href: "/settings",
                  icon: Settings,
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
