import i18next from "i18next";

/** Locale tag for date/number formatting: the active UI language, English before i18n is ready. */
export function getActiveLocale(): string {
  return i18next.language?.split("-")[0] || "en";
}
