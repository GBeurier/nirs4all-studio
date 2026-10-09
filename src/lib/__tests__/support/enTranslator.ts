import i18next from "i18next";
import en from "@/locales/en";

const instance = i18next.createInstance();
void instance.init({
  lng: "en",
  resources: { en: { translation: en } },
  initAsync: false,
  interpolation: { escapeValue: false },
});

/** Real English translator for pure helpers that take a `t` parameter. */
export const tEn = instance.t.bind(instance);
