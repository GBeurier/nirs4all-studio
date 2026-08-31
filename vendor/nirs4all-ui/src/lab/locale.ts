// Bilingual support for the lab display catalogs. The view-model builders take an
// optional `locale` (default 'fr') and resolve the FR/EN text so hosts get a
// ready-to-render string. Pure data + one resolver; no React, no IO.
export type Locale = 'fr' | 'en';

export interface LocalizedText {
  fr: string;
  en: string;
}

export function loc(text: LocalizedText, locale: Locale = 'fr'): string {
  return locale === 'en' ? text.en : text.fr;
}
