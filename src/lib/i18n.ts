/**
 * i18n (Internationalization) Configuration
 *
 * This module sets up react-i18next for the nirs4all webapp.
 * Only English (en) and French (fr) are selectable: the other locale folders
 * are partial and are not loaded until they are completed. English is bundled
 * as the fallback; French is a separate chunk fetched on demand by a small
 * i18next backend (`i18nReady` resolves once the detected language is loaded).
 */

import i18n, { type BackendModule } from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

// English is the fallback and always bundled; other languages load on demand.
import en from "@/locales/en";

const lazyLocales: Record<string, () => Promise<{ default: object }>> = {
  fr: () => import("@/locales/fr"),
};

/** i18next backend that fetches a non-bundled language the first time it is used. */
const lazyLocaleBackend: BackendModule = {
  type: "backend",
  init: () => undefined,
  read(language, _namespace, callback) {
    const load = lazyLocales[language];
    if (!load) {
      callback(null, {});
      return;
    }
    load().then(
      (module) => callback(null, module.default as Record<string, unknown>),
      (error: unknown) => callback(error instanceof Error ? error : new Error(String(error)), false),
    );
  },
};

// Supported languages configuration
export const supportedLanguages = [
  { code: "en", name: "English", nativeName: "English", flag: "🇬🇧" },
  { code: "fr", name: "French", nativeName: "Français", flag: "🇫🇷" },
] as const;

export type SupportedLanguage = (typeof supportedLanguages)[number]["code"];

// Default language
export const defaultLanguage: SupportedLanguage = "en";

/** Resolves once the detected UI language is loaded and ready to render. */
export const i18nReady = i18n
  .use(lazyLocaleBackend)
  // Detect user language
  .use(LanguageDetector)
  // Pass the i18n instance to react-i18next
  .use(initReactI18next)
  // Initialize configuration
  .init({
    // Resources containing translations
    resources: {
      en: { translation: en },
    },
    partialBundledLanguages: true,

    // Default and fallback language
    fallbackLng: defaultLanguage,
    supportedLngs: supportedLanguages.map((l) => l.code),
    nonExplicitSupportedLngs: true,
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
      order: ["localStorage", "htmlTag"],
      // Cache language in localStorage
      caches: ["localStorage"],
      // localStorage key for language
      lookupLocalStorage: "nirs4all-language",
    },

    // React options
    react: {
      useSuspense: true,
    },
  })
  .then(() => undefined);

// Apply document direction on init and language change
i18n.on("languageChanged", (lang) => {
  document.documentElement.dir = "ltr";
  document.documentElement.lang = lang;
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
