/**
 * Theme Context
 *
 * Provides application-wide theme management with:
 * - Client-storage persistence (fallback)
 * - Backend workspace settings sync (primary when workspace is available)
 * - System theme detection
 *
 * Phase 2 Enhancement: Theme persistence to workspace settings
 */

import {
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { getWorkspaceSettings, updateWorkspaceSettings } from "@/api/workspace";
import { ThemeContext, type Theme } from "@/context/useTheme";
import {
  readClientStorageString,
  themePreferenceStorageKey,
  writeClientStorageString,
} from "@/lib/clientStorage";

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

export function ThemeProvider({
  children,
  defaultTheme = "light",
  storageKey = "nirs4all-theme",
}: ThemeProviderProps) {
  // Initialize from client storage first for fast initial render.
  const [theme, setThemeState] = useState<Theme>(() => {
    return (readClientStorageString(themePreferenceStorageKey(storageKey)) as Theme | null) || defaultTheme;
  });

  const [resolvedTheme, setResolvedTheme] = useState<"dark" | "light">("dark");
  const [isLoading, setIsLoading] = useState(true);
  const [hasWorkspace, setHasWorkspace] = useState(false);

  // Expose theme initialization lifecycle for E2E synchronization.
  useEffect(() => {
    window.document.documentElement.dataset.themeReady = String(!isLoading);
  }, [isLoading]);

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
        // No workspace or error - use client-storage value.
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

  // Always save to client storage for fast initial load.
  useEffect(() => {
    writeClientStorageString(themePreferenceStorageKey(storageKey), theme);
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
      writeClientStorageString(themePreferenceStorageKey(storageKey), newTheme);

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
          // Silently fail - client storage is the fallback.
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
