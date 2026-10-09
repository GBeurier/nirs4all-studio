import i18next from "i18next";
import en from "@/locales/en";

// Side-effect module: initialises the global i18next instance with the real English resources for
// pure helpers that call `i18next.t` at call time.
void i18next.init({
  lng: "en",
  resources: { en: { translation: en } },
  initAsync: false,
  interpolation: { escapeValue: false },
});
