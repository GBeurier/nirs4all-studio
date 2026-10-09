import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import en from "@/locales/en";

/** Initialise i18next with the real English resources so rendered text can be asserted. */
export async function initEnglishI18n(): Promise<void> {
  if (i18next.isInitialized && i18next.language === "en") return;
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
}
