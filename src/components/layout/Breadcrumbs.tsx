import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";
import { cn } from "@/lib/utils";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

const routeLabels: Record<string, string> = {
  datasets: "Datasets",
  playground: "Playground",
  pipelines: "Pipelines",
  runs: "Runs",
  results: "Results",
  predictions: "Predictions",
  analysis: "Analysis",
  settings: "Settings",
  new: "New",
};

function generateBreadcrumbs(pathname: string): BreadcrumbItem[] {
  const paths = pathname.split("/").filter(Boolean);
  
  if (paths.length === 0) {
    return [{ label: "Dashboard" }];
  }

  const breadcrumbs: BreadcrumbItem[] = [];
  let currentPath = "";

  for (let i = 0; i < paths.length; i++) {
    const segment = paths[i];
    currentPath += `/${segment}`;
    
    // Check if this is a dynamic segment (like an ID)
    const isDynamicSegment = !routeLabels[segment] && segment !== "new";
    
    if (isDynamicSegment) {
      // For dynamic segments, use a shortened version or the segment itself
      breadcrumbs.push({
        label: segment.length > 8 ? `${segment.slice(0, 8)}...` : segment,
        href: i < paths.length - 1 ? currentPath : undefined,
      });
    } else {
      breadcrumbs.push({
        label: routeLabels[segment] || segment,
        href: i < paths.length - 1 ? currentPath : undefined,
      });
    }
  }

  return breadcrumbs;
}

export function Breadcrumbs() {
  const location = useLocation();
  const breadcrumbs = generateBreadcrumbs(location.pathname);

  // Don't show breadcrumbs on the dashboard
  if (location.pathname === "/") {
    return null;
  }

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm">
      <Link
        to="/"
        className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
      >
        <Home className="h-4 w-4" />
        <span className="sr-only">Dashboard</span>
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
