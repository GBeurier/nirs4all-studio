import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Moon, Sun, Monitor, Search, Command } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Breadcrumbs } from "./Breadcrumbs";
import { MobileSidebar } from "./MobileSidebar";

// Quick search navigation items with translation keys
const searchItems = [
  { labelKey: "nav.datasets", path: "/datasets", keywords: ["data", "import", "load"] },
  { labelKey: "nav.pipelines", path: "/pipelines", keywords: ["workflow", "ml", "model"] },
  { labelKey: "nav.pipelineEditor", path: "/pipelines/new", keywords: ["editor", "create", "build", "new", "design"] },
  { labelKey: "nav.playground", path: "/playground", keywords: ["explore", "visualize", "spectra"] },
  { labelKey: "nav.inspector", path: "/inspector", keywords: ["predict", "batch", "analysis"] },
  { labelKey: "nav.runs", path: "/runs", keywords: ["execute", "monitor", "progress"] },
  { labelKey: "nav.scores", path: "/results", keywords: ["metrics", "performance", "evaluate", "compare", "results"] },
  { labelKey: "nav.aggregatedResults", path: "/results/aggregated", keywords: ["aggregate", "chain", "fold", "summary", "ranking"] },
  { labelKey: "nav.predictions", path: "/predictions", keywords: ["predict", "inference"] },
  { labelKey: "nav.lab", path: "/lab", keywords: ["synthesis", "transfer", "shapley", "shap", "importance"] },
  { labelKey: "nav.settings", path: "/settings", keywords: ["config", "preferences", "options"] },
];

export function AppHeader() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchResults, setShowSearchResults] = useState(false);

  const filteredItems = searchQuery.trim()
    ? searchItems.filter((item) => {
        const query = searchQuery.toLowerCase();
        const label = t(item.labelKey).toLowerCase();
        return (
          label.includes(query) ||
          item.keywords.some((k) => k.includes(query))
        );
      })
    : [];

  const handleSearch = useCallback(
    (path: string) => {
      navigate(path);
      setSearchQuery("");
      setShowSearchResults(false);
    },
    [navigate]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && filteredItems.length > 0) {
      handleSearch(filteredItems[0].path);
    }
    if (e.key === "Escape") {
      setShowSearchResults(false);
      setSearchQuery("");
    }
  };

  return (
    <header className="flex h-16 items-center justify-between border-b border-border/50 bg-background px-4 md:px-6">
      <div className="flex items-center gap-4">
        {/* Mobile menu trigger */}
        <MobileSidebar />

        {/* Breadcrumbs - hidden on mobile */}
        <div className="hidden md:block">
          <Breadcrumbs />
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Search - hidden on small screens */}
        <div className="relative hidden sm:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("layout.header.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setShowSearchResults(true);
            }}
            onFocus={() => setShowSearchResults(true)}
            onBlur={() => {
              // Delay to allow click on results
              setTimeout(() => setShowSearchResults(false), 200);
            }}
            onKeyDown={handleKeyDown}
            className="w-48 lg:w-64 pl-9 pr-12 bg-muted/50 border-border/50 focus:bg-muted"
          />
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 hidden lg:inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            <Command className="h-3 w-3" />K
          </kbd>

          {/* Search Results Dropdown */}
          {showSearchResults && filteredItems.length > 0 && (
            <div className="absolute top-full mt-2 w-full rounded-md border border-border bg-popover p-1 shadow-lg z-50">
              {filteredItems.map((item) => (
                <button
                  key={item.path}
                  onClick={() => handleSearch(item.path)}
                  className="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-left hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  {t(item.labelKey)}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Mobile search button */}
        <Button variant="ghost" size="icon" className="sm:hidden h-9 w-9">
          <Search className="h-4 w-4" />
          <span className="sr-only">{t("layout.header.search")}</span>
        </Button>

        {/* Theme Toggle */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-9 w-9">
              {theme === "light" && <Sun className="h-4 w-4" />}
              {theme === "dark" && <Moon className="h-4 w-4" />}
              {theme === "system" && <Monitor className="h-4 w-4" />}
              <span className="sr-only">{t("layout.header.toggleTheme")}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setTheme("light")}>
              <Sun className="mr-2 h-4 w-4" />
              {t("settings.general.appearance.themeLight")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("dark")}>
              <Moon className="mr-2 h-4 w-4" />
              {t("settings.general.appearance.themeDark")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("system")}>
              <Monitor className="mr-2 h-4 w-4" />
              {t("settings.general.appearance.themeSystem")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
