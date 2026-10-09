import { type ClassValue, clsx } from "clsx";
import i18next from "i18next";
import { twMerge } from "tailwind-merge";
import { getActiveLocale } from "@/lib/activeLocale";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a number in compact notation for the active locale (e.g. "1.5K" / "1,5 k")
 */
export function formatNumber(num: number): string {
  if (num >= 1000) {
    return new Intl.NumberFormat(getActiveLocale(), { notation: "compact", maximumFractionDigits: 1 }).format(num);
  }
  return num.toLocaleString(getActiveLocale());
}

/**
 * Format a date to a readable string
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(getActiveLocale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Format a date to a relative string (e.g., "2 days ago")
 */
export function formatRelativeDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return i18next.t("time.today");
  if (diffDays === 1) return i18next.t("time.yesterday");
  if (diffDays < 7) return i18next.t("time.daysAgo", { count: diffDays });
  if (diffDays < 30) return i18next.t("time.weeksAgo", { count: Math.floor(diffDays / 7) });
  if (diffDays < 365) return i18next.t("time.monthsAgo", { count: Math.floor(diffDays / 30) });
  return i18next.t("time.yearsAgo", { count: Math.floor(diffDays / 365) });
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return `0 ${i18next.t("common.format.byteUnit.b")}`;
  const k = 1024;
  const units = ["b", "kb", "mb", "gb", "tb"] as const;
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
  const value = new Intl.NumberFormat(getActiveLocale(), { maximumFractionDigits: 2 }).format(bytes / Math.pow(k, i));
  return `${value} ${i18next.t(`common.format.byteUnit.${units[i]}`)}`;
}

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

/**
 * Debounce a function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}
