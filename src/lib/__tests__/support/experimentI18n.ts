import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import en from "@/locales/en";

/**
 * Side-effect module: initialises the default i18next instance synchronously with the real
 * English resources, so view-model helpers that call `i18n.t` and rendered components produce
 * the English copy the experiment-wizard tests assert on.
 */
if (!i18next.isInitialized) {
  void i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
    initAsync: false,
  });
}
