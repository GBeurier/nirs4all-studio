/**
 * i18n (Internationalization) Configuration
 *
 * This module sets up react-i18next for the nirs4all webapp.
 * Supports English (en), French (fr), and German (de) languages.
 *
 * Phase 6 Implementation - Settings Roadmap
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

// Import translation resources
import en from "@/locales/en";
import fr from "@/locales/fr";
import de from "@/locales/de";

// Supported languages configuration
export const supportedLanguages = [
  { code: "en", name: "English", nativeName: "English", flag: "🇬🇧" },
  { code: "fr", name: "French", nativeName: "Français", flag: "🇫🇷" },
  { code: "de", name: "German", nativeName: "Deutsch", flag: "🇩🇪" },
] as const;

export type SupportedLanguage = (typeof supportedLanguages)[number]["code"];

// Default language
export const defaultLanguage: SupportedLanguage = "en";

// Initialize i18next
i18n
  // Detect user language
  .use(LanguageDetector)
  // Pass the i18n instance to react-i18next
  .use(initReactI18next)
  // Initialize configuration
  .init({
    // Resources containing translations
    resources: {
      en: { translation: en },
      fr: { translation: fr },
      de: { translation: de },
    },

    // Default and fallback language
    fallbackLng: defaultLanguage,
    lng: undefined, // Let detector find it

    // Debug mode (only in development)
    debug: import.meta.env.DEV,

    // Interpolation options
    interpolation: {
      escapeValue: false, // React already protects from XSS
    },

    // Detection options
    detection: {
      // Order of language detection methods
      order: ["localStorage", "navigator", "htmlTag"],
      // Cache language in localStorage
      caches: ["localStorage"],
      // localStorage key for language
      lookupLocalStorage: "nirs4all-language",
    },

    // React options
    react: {
      useSuspense: true,
    },
  });

export default i18n;

/**
 * Helper function to get current language
 */
export function getCurrentLanguage(): SupportedLanguage {
  const current = i18n.language?.split("-")[0] as SupportedLanguage;
  return supportedLanguages.some((l) => l.code === current)
    ? current
    : defaultLanguage;
}

/**
 * Helper function to change language
 */
export async function changeLanguage(
  lang: SupportedLanguage
): Promise<void> {
  await i18n.changeLanguage(lang);
}

/**
 * Helper function to check if language is supported
 */
export function isLanguageSupported(lang: string): lang is SupportedLanguage {
  return supportedLanguages.some((l) => l.code === lang);
}
