import { createContext, useContext } from "react";

import {
  supportedLanguages,
  type SupportedLanguage,
} from "@/lib/i18n";

/**
 * Language context type definition
 */
export interface LanguageContextType {
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

export const LanguageContext = createContext<LanguageContextType | undefined>(
  undefined,
);

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
