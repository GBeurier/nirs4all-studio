/**
 * Theme Context
 *
 * Provides application-wide theme management with:
 * - Local storage persistence (fallback)
 * - Backend workspace settings sync (primary when workspace is available)
 * - System theme detection
 *
 * Phase 2 Enhancement: Theme persistence to workspace settings
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { getWorkspaceSettings, updateWorkspaceSettings } from "@/api/client";
import type { ThemeOption } from "@/types/settings";

type Theme = ThemeOption;

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: "dark" | "light";
  isLoading: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

// Helper to safely access localStorage (may be null in pywebview/embedded contexts)
function getLocalStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // localStorage access can throw in some contexts
  }
  return null;
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "nirs4all-theme",
}: ThemeProviderProps) {
  // Initialize from localStorage first for fast initial render
  const [theme, setThemeState] = useState<Theme>(() => {
    const storage = getLocalStorage();
    if (storage) {
      return (storage.getItem(storageKey) as Theme) || defaultTheme;
    }
    return defaultTheme;
  });

  const [resolvedTheme, setResolvedTheme] = useState<"dark" | "light">("dark");
  const [isLoading, setIsLoading] = useState(true);
  const [hasWorkspace, setHasWorkspace] = useState(false);

  // Load theme from workspace settings (runs after mount)
  useEffect(() => {
    const loadFromWorkspace = async () => {
      try {
        const settings = await getWorkspaceSettings();
        const workspaceTheme = settings.general?.theme;
        // Validate the theme value from backend
        if (workspaceTheme === "light" || workspaceTheme === "dark" || workspaceTheme === "system") {
          setThemeState(workspaceTheme);
          setHasWorkspace(true);
        } else {
          setHasWorkspace(true);
        }
      } catch {
        // No workspace or error - use localStorage value
        setHasWorkspace(false);
      } finally {
        setIsLoading(false);
      }
    };
    loadFromWorkspace();
  }, []);

  // Apply theme to document
  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove("light", "dark");

    let effectiveTheme: "dark" | "light";

    if (theme === "system") {
      effectiveTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    } else {
      effectiveTheme = theme;
    }

    root.classList.add(effectiveTheme);
    setResolvedTheme(effectiveTheme);
  }, [theme]);

  // Always save to localStorage for fast initial load
  useEffect(() => {
    const storage = getLocalStorage();
    if (storage) {
      storage.setItem(storageKey, theme);
    }
  }, [theme, storageKey]);

  // Listen for system theme changes
  useEffect(() => {
    if (theme !== "system") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e: MediaQueryListEvent) => {
      const root = window.document.documentElement;
      root.classList.remove("light", "dark");
      const newTheme = e.matches ? "dark" : "light";
      root.classList.add(newTheme);
      setResolvedTheme(newTheme);
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);

  // Set theme and sync to backend if workspace is available
  const setTheme = useCallback(
    async (newTheme: Theme) => {
      setThemeState(newTheme);
      const storage = getLocalStorage();
      if (storage) {
        storage.setItem(storageKey, newTheme);
      }

      // Try to sync to workspace settings
      if (hasWorkspace) {
        try {
          const settings = await getWorkspaceSettings();
          const currentGeneral = settings.general || {
            theme: "system",
            ui_density: "comfortable",
            reduce_animations: false,
            sidebar_collapsed: false,
          };
          await updateWorkspaceSettings({
            general: { ...currentGeneral, theme: newTheme },
          });
        } catch (error) {
          // Silently fail - localStorage is the fallback
          console.debug("Failed to sync theme to workspace:", error);
        }
      }
    },
    [hasWorkspace, storageKey]
  );

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme, isLoading }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
