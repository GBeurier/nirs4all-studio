/**
 * Spectra Synthesis Definition Labels
 *
 * Resolves the localized text of catalog entries. The catalogs only carry
 * identifiers; the visible names and descriptions live in the locale files.
 */

import type { TFunction } from "i18next";

export function getStepName(t: TFunction, stepType: string): string {
  return t(`spectraSynthesis.steps.${stepType}.name`);
}

export function getStepDescription(t: TFunction, stepType: string): string {
  return t(`spectraSynthesis.steps.${stepType}.description`);
}

export function getCategoryLabel(t: TFunction, categoryId: string): string {
  return t(`spectraSynthesis.categories.${categoryId}`);
}

export function getComponentCategoryLabel(t: TFunction, category: string): string {
  return t(`spectraSynthesis.componentCategories.${category}`, { defaultValue: category });
}

/** Localized chemical component name; unknown identifiers are shown as-is. */
export function getComponentLabel(t: TFunction, componentName: string): string {
  return t(`spectraSynthesis.components.${componentName}`, { defaultValue: componentName });
}
