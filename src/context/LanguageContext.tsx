/**
 * Language Context Provider
 *
 * Manages language preferences with persistence to both localStorage and workspace settings.
 * Provides hooks for accessing and changing the current language.
 *
 * Phase 6 Implementation - Settings Roadmap
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  supportedLanguages,
  defaultLanguage,
  getCurrentLanguage,
  changeLanguage as i18nChangeLanguage,
  type SupportedLanguage,
} from "@/lib/i18n";
import { getWorkspaceSettings, updateWorkspaceSettings } from "@/api/client";

/**
 * Language context type definition
 */
interface LanguageContextType {
  /** Current language code */
  language: SupportedLanguage;
  /** Change the current language */
  changeLanguage: (lang: SupportedLanguage) => Promise<void>;
  /** List of supported languages */
  languages: typeof supportedLanguages;
  /** Whether the language is being loaded/changed */
  isLoading: boolean;
  /** Get display name for current language */
  currentLanguageDisplay: string;
  /** Get native name for current language */
  currentLanguageNative: string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(
  undefined
);

/**
 * Local storage key for language preference
 */
const LANGUAGE_STORAGE_KEY = "nirs4all-language";

/**
 * Language Provider Component
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const [language, setLanguage] = useState<SupportedLanguage>(
    getCurrentLanguage()
  );
  const [isLoading, setIsLoading] = useState(false);

  // Sync language from backend on mount
  useEffect(() => {
    const loadLanguageFromBackend = async () => {
      try {
        const settings = await getWorkspaceSettings();
        if (settings.general?.language) {
          const backendLang = settings.general.language as SupportedLanguage;
          if (
            supportedLanguages.some((l) => l.code === backendLang) &&
            backendLang !== language
          ) {
            await i18nChangeLanguage(backendLang);
            setLanguage(backendLang);
          }
        }
      } catch {
        // Backend not available, use localStorage fallback
        const storedLang = localStorage.getItem(
          LANGUAGE_STORAGE_KEY
        ) as SupportedLanguage | null;
        if (storedLang && supportedLanguages.some((l) => l.code === storedLang)) {
          if (storedLang !== language) {
            await i18nChangeLanguage(storedLang);
            setLanguage(storedLang);
          }
        }
      }
    };

    loadLanguageFromBackend();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep language state in sync with i18n
  useEffect(() => {
    const handleLanguageChange = (lng: string) => {
      const newLang = lng.split("-")[0] as SupportedLanguage;
      if (supportedLanguages.some((l) => l.code === newLang)) {
        setLanguage(newLang);
      }
    };

    i18n.on("languageChanged", handleLanguageChange);
    return () => {
      i18n.off("languageChanged", handleLanguageChange);
    };
  }, [i18n]);

  /**
   * Change the current language
   */
  const changeLanguage = useCallback(
    async (newLang: SupportedLanguage) => {
      if (!supportedLanguages.some((l) => l.code === newLang)) {
        console.warn(`Unsupported language: ${newLang}`);
        return;
      }

      if (newLang === language) {
        return;
      }

      setIsLoading(true);

      try {
        // Change i18n language
        await i18nChangeLanguage(newLang);
        setLanguage(newLang);

        // Save to localStorage for fallback
        localStorage.setItem(LANGUAGE_STORAGE_KEY, newLang);

        // Try to persist to backend
        try {
          await updateWorkspaceSettings({
            general: {
              language: newLang,
            },
          } as Parameters<typeof updateWorkspaceSettings>[0]);
        } catch {
          // Backend not available, already saved to localStorage
        }
      } finally {
        setIsLoading(false);
      }
    },
    [language]
  );

  // Get display info for current language
  const currentLangInfo = supportedLanguages.find((l) => l.code === language);
  const currentLanguageDisplay = currentLangInfo?.name ?? "English";
  const currentLanguageNative = currentLangInfo?.nativeName ?? "English";

  return (
    <LanguageContext.Provider
      value={{
        language,
        changeLanguage,
        languages: supportedLanguages,
        isLoading,
        currentLanguageDisplay,
        currentLanguageNative,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

/**
 * Hook to access language context
 */
export function useLanguage(): LanguageContextType {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}

/**
 * Simple hook to get current language code
 */
export function useCurrentLanguage(): SupportedLanguage {
  const { language } = useLanguage();
  return language;
}
