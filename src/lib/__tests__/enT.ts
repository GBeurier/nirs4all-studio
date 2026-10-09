import i18next, { type TFunction } from "i18next";

import en from "@/locales/en";

const instance = i18next.createInstance();
await instance.init({ lng: "en", resources: { en: { translation: en } }, interpolation: { escapeValue: false } });

/** Translator bound to the real English resources, for tests of pure label builders. */
export const enT = instance.t.bind(instance) as unknown as TFunction;
