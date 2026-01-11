import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronRight, Home } from "lucide-react";
import { cn } from "@/lib/utils";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

// Map route segments to translation keys
const routeTranslationKeys: Record<string, string> = {
  datasets: "nav.datasets",
  playground: "nav.playground",
  pipelines: "nav.pipelines",
  runs: "nav.runs",
  results: "nav.results",
  predictions: "nav.predictions",
  analysis: "nav.analysis",
  settings: "nav.settings",
  new: "pipelines.newPipeline",
};

export function Breadcrumbs() {
  const { t } = useTranslation();
  const location = useLocation();

  const generateBreadcrumbs = (pathname: string): BreadcrumbItem[] => {
    const paths = pathname.split("/").filter(Boolean);

    if (paths.length === 0) {
      return [{ label: t("nav.dashboard") }];
    }

    const breadcrumbs: BreadcrumbItem[] = [];
    let currentPath = "";

    for (let i = 0; i < paths.length; i++) {
      const segment = paths[i];
      currentPath += `/${segment}`;

      // Check if this is a dynamic segment (like an ID)
      const translationKey = routeTranslationKeys[segment];
      const isDynamicSegment = !translationKey && segment !== "new";

      if (isDynamicSegment) {
        // For dynamic segments, use a shortened version or the segment itself
        breadcrumbs.push({
          label: segment.length > 8 ? `${segment.slice(0, 8)}...` : segment,
          href: i < paths.length - 1 ? currentPath : undefined,
        });
      } else {
        breadcrumbs.push({
          label: translationKey ? t(translationKey) : segment,
          href: i < paths.length - 1 ? currentPath : undefined,
        });
      }
    }

    return breadcrumbs;
  };

  // Don't show breadcrumbs on the dashboard
  if (location.pathname === "/") {
    return null;
  }

  const breadcrumbs = generateBreadcrumbs(location.pathname);

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm">
      <Link
        to="/"
        className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
      >
        <Home className="h-4 w-4" />
        <span className="sr-only">{t("nav.dashboard")}</span>
      </Link>

      {breadcrumbs.map((item, index) => (
        <div key={index} className="flex items-center gap-1">
          <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
          {item.href ? (
            <Link
              to={item.href}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {item.label}
            </Link>
          ) : (
            <span className={cn("font-medium text-foreground")}>
              {item.label}
            </span>
          )}
        </div>
      ))}
    </nav>
  );
}
