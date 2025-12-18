import { useLocation } from "react-router-dom";
import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const routeTitles: Record<string, string> = {
  "/": "Dashboard",
  "/datasets": "Datasets",
  "/playground": "Playground",
  "/pipelines": "Pipelines",
  "/runs": "Runs",
  "/results": "Results",
  "/predictions": "Predictions",
  "/settings": "Settings",
};

export function AppHeader() {
  const location = useLocation();
  const { theme, setTheme } = useTheme();

  // Get title from route, with special handling for nested routes
  const getTitle = () => {
    const path = location.pathname;
    if (routeTitles[path]) {
      return routeTitles[path];
    }
    // Handle nested routes like /pipelines/new
    const basePath = "/" + path.split("/")[1];
    return routeTitles[basePath] || "nirs4all";
  };

  return (
    <header className="flex h-16 items-center justify-between border-b border-border/50 bg-background px-6">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-semibold text-foreground">{getTitle()}</h1>
      </div>

      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-9 w-9">
              {theme === "light" && <Sun className="h-4 w-4" />}
              {theme === "dark" && <Moon className="h-4 w-4" />}
              {theme === "system" && <Monitor className="h-4 w-4" />}
              <span className="sr-only">Toggle theme</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setTheme("light")}>
              <Sun className="mr-2 h-4 w-4" />
              Light
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("dark")}>
              <Moon className="mr-2 h-4 w-4" />
              Dark
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("system")}>
              <Monitor className="mr-2 h-4 w-4" />
              System
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
