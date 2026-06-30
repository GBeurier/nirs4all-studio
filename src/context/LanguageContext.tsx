/**
 * Language Context Provider
 *
 * Manages language preferences with persistence to both client storage and workspace settings.
 * Provides hooks for accessing and changing the current language.
 *
 * Phase 6 Implementation - Settings Roadmap
 */

import {
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
import { getWorkspaceSettings, updateWorkspaceSettings } from "@/api/workspace";
import { LanguageContext } from "@/context/useLanguage";
import {
  clientStorageKeys,
  readClientStorageString,
  writeClientStorageString,
} from "@/lib/clientStorage";

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
        // Backend not available, use client storage fallback
        const storedLang = readClientStorageString(
          clientStorageKeys.languagePreference
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

        // Save to client storage for fallback
        writeClientStorageString(clientStorageKeys.languagePreference, newLang);

        // Try to persist to backend
        try {
          await updateWorkspaceSettings({
            general: {
              language: newLang,
            },
          } as Parameters<typeof updateWorkspaceSettings>[0]);
        } catch {
          // Backend not available, already saved to client storage
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
